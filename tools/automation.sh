#!/usr/bin/env bash
# SoulStream automation.
#
# Build host (workstation, with Android SDK + gh):
#   tools/automation.sh build [--branch <ref>] [--version <x.y.z>]
#
# VPS (read-only GitHub access, no Android toolchain):
#   automation.sh check
#   automation.sh watch [--dry-run]
#   automation.sh deploy --tag v1.2.3 [--force] [--dry-run]
#   automation.sh install-timer --yes
#
# The VPS watcher checks every branch and the latest GitHub release. It can
# deploy a published release (the site bundle attached by `build`), but it does
# not build or push: the VPS has no Android SDK and no GitHub write credentials.
# Configure TRIGGER_BUILD_CMD in config.env if you want it to wake a build host.

set -euo pipefail

REPO_SLUG="${REPO_SLUG:-Thibaut-Fontaine/soulseek-streaming}"
REPO_URL="${REPO_URL:-https://github.com/${REPO_SLUG}.git}"
WEB_URL="${WEB_URL:-https://thibautfontaine.space/streaming}"
SITE_DIR="${SITE_DIR:-/var/www/thibautfontaine.space/streaming}"
AUTOMATION_DIR="${AUTOMATION_DIR:-$HOME/soulstream-automation}"
STATE_FILE="$AUTOMATION_DIR/state.json"
BUILD_NEEDED_FILE="$AUTOMATION_DIR/build-needed.json"
LOG_FILE="$AUTOMATION_DIR/automation.log"
LOCK_FILE="$AUTOMATION_DIR/lock"
ANDROID_ARCHS="${ANDROID_ARCHS:-arm64-v8a,armeabi-v7a,x86_64}"
GH_BIN="${GH_BIN:-gh}"
API="https://api.github.com/repos/$REPO_SLUG"

MODE=""
DRY_RUN=0
FORCE=0
ASSUME_YES=0
BRANCH_ARG=""
VERSION_ARG=""
TAG_ARG=""
BUNDLE_ARG=""
NO_PUSH=0

if [ -f "$AUTOMATION_DIR/config.env" ]; then
  # shellcheck disable=SC1091
  . "$AUTOMATION_DIR/config.env"
fi

log() {
  mkdir -p "$AUTOMATION_DIR"
  printf '%s %s\n' "$(date -u +%FT%TZ)" "$*" | tee -a "$LOG_FILE"
}

die() {
  log "ERROR: $*"
  exit 1
}

run() {
  if [ "$DRY_RUN" = 1 ]; then
    log "DRY: $*"
  else
    "$@"
  fi
}

usage() {
  cat <<'EOF'
Usage:
  automation.sh build [--branch origin/B] [--version x.y.z] [--no-push]
      Build host only: merge a collaborator branch, test, bump version,
      build the APK, publish main + a GitHub release with the site bundle.

  automation.sh check
      Show the latest release and the remote branch tips.

  automation.sh watch [--dry-run]
      VPS: log branch changes and deploy a newly published release/site bundle.

  automation.sh deploy --tag vX.Y.Z [--force] [--dry-run]
  automation.sh deploy --bundle site.zip [--tag vX.Y.Z]
      Deploy one release, or a local site bundle built from a branch APK.

  automation.sh install-timer [--yes]
      Install and start the systemd timer for `watch` (every 15 min).

Environment:
  SITE_DIR, WEB_URL, REPO_SLUG, REPO_URL, AUTOMATION_DIR,
  ANDROID_ARCHS, GH_BIN, VPS_HOST, TRIGGER_BUILD_CMD
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    --force) FORCE=1 ;;
    --yes) ASSUME_YES=1 ;;
    --branch) BRANCH_ARG="${2:?--branch needs a value}"; shift ;;
    --version) VERSION_ARG="${2:?--version needs a value}"; shift ;;
    --tag) TAG_ARG="${2:?--tag needs a value}"; shift ;;
    --bundle) BUNDLE_ARG="${2:?--bundle needs a value}"; shift ;;
    --no-push) NO_PUSH=1 ;;
    -h|--help|help) MODE="help" ;;
    build|check|watch|deploy|install-timer) MODE="$1" ;;
    *) die "unknown argument: $1 (see --help)" ;;
  esac
  shift
done
MODE="${MODE:-help}"

mkdir -p "$AUTOMATION_DIR"

# ---------------------------------------------------------------- GitHub ----

release_json_latest() {
  curl -fsSL \
    -H 'Accept: application/vnd.github+json' \
    -H 'User-Agent: SoulStream-Automation' \
    "$API/releases/latest"
}

release_json_tag() {
  local tag="$1"
  curl -fsSL \
    -H 'Accept: application/vnd.github+json' \
    -H 'User-Agent: SoulStream-Automation' \
    "$API/releases/tags/$tag"
}

# Output TAG, then one ASSET line per asset.
release_summary() {
  python3 -c '
import json, sys
d = json.load(sys.stdin)
print("TAG\t" + (d.get("tag_name") or ""))
for a in d.get("assets") or []:
    digest = (a.get("digest") or "").replace("sha256:", "")
    print("ASSET\t%s\t%s\t%s\t%s" % (
        a.get("name", ""), a.get("browser_download_url", ""), digest, a.get("size", 0)))
' 
}

latest_tag() {
  release_json_latest | release_summary | awk -F'\t' '$1 == "TAG" {print $2}'
}

branch_tips() {
  GIT_TERMINAL_PROMPT=0 git ls-remote --heads "$REPO_URL" |
    sed 's#refs/heads/##' |
    awk '{print $2 "\t" $1}' |
    sort
}

# ---------------------------------------------------------------- state -----

state_get_release() {
  [ -f "$STATE_FILE" ] || { echo ""; return; }
  python3 - "$STATE_FILE" <<'PY'
import json, sys
try:
    with open(sys.argv[1]) as f:
        print(json.load(f).get("release_tag", ""))
except Exception:
    print("")
PY
}

state_set_release() {
  local tag="$1"
  python3 - "$STATE_FILE" "$tag" <<'PY'
import json, sys, datetime, os
path, tag = sys.argv[1], sys.argv[2]
try:
    with open(path) as f:
        data = json.load(f)
except Exception:
    data = {}
data["release_tag"] = tag
data["updated_at"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
os.makedirs(os.path.dirname(path), exist_ok=True)
with open(path, "w") as f:
    json.dump(data, f, indent=2)
PY
}

state_init() {
  local tag tips tmp
  tag="$(latest_tag || true)"
  tips="$(branch_tips || true)"
  tmp="$(mktemp)"
  printf '%s\n' "$tips" > "$tmp"
  python3 - "$STATE_FILE" "$tag" "$tmp" <<'PY'
import json, sys, datetime, os
path, tag, tips_path = sys.argv[1], sys.argv[2], sys.argv[3]
branches = {}
with open(tips_path) as f:
    for line in f:
        line = line.strip()
        if not line:
            continue
        branch, sha = line.split("\t", 1)
        branches[branch] = sha
os.makedirs(os.path.dirname(path), exist_ok=True)
with open(path, "w") as f:
    json.dump({
        "release_tag": tag,
        "branches": branches,
        "updated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    }, f, indent=2)
print(tag)
PY
  rm -f "$tmp"
}

# Compare current branch tips to state, update state, write build-needed.json.
# Prints "CHANGED branch old new" lines. Only ccr-* changes trigger a build.
compare_branches() {
  local tips="$1"
  python3 - "$STATE_FILE" "$BUILD_NEEDED_FILE" "$tips" <<'PY'
import json, sys, datetime, os
state_path, needed_path, tips_path = sys.argv[1:4]
try:
    with open(state_path) as f:
        state = json.load(f)
except Exception:
    state = {}
old = state.get("branches") or {}
new = {}
with open(tips_path) as f:
    for line in f:
        line = line.strip()
        if line:
            b, s = line.split("\t", 1)
            new[b] = s
changes = []
for b in sorted(new):
    if old.get(b) != new[b]:
        changes.append((b, old.get(b, ""), new[b]))
for b, o, n in changes:
    print("CHANGED\t%s\t%s\t%s" % (b, o, n))
state["branches"] = new
state["updated_at"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
with open(state_path, "w") as f:
    json.dump(state, f, indent=2)
ccr = [{"branch": b, "old": o, "new": n} for b, o, n in changes if b.startswith("ccr-")]
if ccr:
    with open(needed_path, "w") as f:
        json.dump({
            "needed_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "branches": ccr,
        }, f, indent=2)
    print("BUILD_NEEDED\t%s" % ccr[0]["branch"])
else:
    try:
        os.unlink(needed_path)
    except FileNotFoundError:
        pass
PY
}

# --------------------------------------------------------------- deploy -----

create_source_zip() {
  local root="$1" out="$2"
  python3 - "$root" "$out" <<'PY'
import os, sys, zipfile
root, out = sys.argv[1], sys.argv[2]
skip_prefixes = (
    "node_modules/", ".git/", "android/build/", "android/app/build/",
    "android/.gradle/", "android/app/.cxx/", "android/.cxx/",
    "ios/Pods/", "ios/build/", ".bundle/", ".claude/", "releases/",
)
skip_names = {"local.properties"}
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    for dirpath, dirs, files in os.walk(root):
        rel_dir = os.path.relpath(dirpath, root).replace(os.sep, "/")
        if rel_dir == ".":
            rel_dir = ""
        dirs[:] = sorted(d for d in dirs if not (
            d == ".git" or d == "node_modules" or d == "Pods" or
            (rel_dir + "/" + d).lstrip("/") in ("android/build", "android/app/build", "android/.gradle", "android/app/.cxx", "android/.cxx", "ios/build")
        ))
        for name in files:
            rel = os.path.join(rel_dir, name).lstrip("/")
            if any(rel.startswith(p) for p in skip_prefixes):
                continue
            if name in skip_names or name.endswith(".hprof"):
                continue
            z.write(os.path.join(dirpath, name), rel)
PY
}

write_sha_sums() {
  local dir="$1"
  ( cd "$dir" && sha256sum SoulStream.apk SoulStream-source.zip > SHA256SUMS.txt )
}

deploy_release() {
  local tag="$1"
  local tmp site bundle_url bundle_digest asset_line apk_sha
  [ -n "$tag" ] || die "deploy: no tag"
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' RETURN

  log "deploy: fetching release $tag"
  release_json_tag "$tag" > "$tmp/release.json" || die "release $tag not found"
  release_summary < "$tmp/release.json" > "$tmp/assets.tsv"

  asset_line="$(awk -F'\t' '$1 == "ASSET" && $2 ~ /^SoulStream-site-.*\.zip$/ {print; exit}' "$tmp/assets.tsv" || true)"
  if [ -n "$asset_line" ]; then
    bundle_url="$(printf '%s' "$asset_line" | cut -f3)"
    bundle_digest="$(printf '%s' "$asset_line" | cut -f4)"
    log "deploy: downloading site bundle"
    curl -fL --retry 3 --retry-all-errors -o "$tmp/site.zip" "$bundle_url"
    if [ -n "$bundle_digest" ]; then
      echo "$bundle_digest  $tmp/site.zip" | sha256sum -c - >/dev/null ||
        die "site bundle digest mismatch"
    fi
    mkdir -p "$tmp/site"
    python3 -m zipfile -e "$tmp/site.zip" "$tmp/site"
    site="$tmp/site"
    [ -f "$site/SoulStream.apk" ] || die "bundle has no APK"
    [ -f "$site/index.html" ] || die "bundle has no index.html"
    [ -f "$site/qr.png" ] || die "bundle has no qr.png"
    [ -f "$site/SoulStream-source.zip" ] || die "bundle has no source ZIP"
    [ -f "$site/SHA256SUMS.txt" ] || die "bundle has no SHA256SUMS.txt"
    [ -d "$site/img" ] || die "bundle has no img/"
    ( cd "$site" && sha256sum -c SHA256SUMS.txt >/dev/null ) || die "bundle checksum mismatch"
  else
    # Fallback for releases without a site bundle: use the tag tarball. The
    # repository contains the built APK in releases/ and the showcase page.
    log "deploy: no site bundle; using tag tarball $tag"
    curl -fL --retry 3 --retry-all-errors \
      -o "$tmp/tag.tar.gz" "https://github.com/$REPO_SLUG/archive/refs/tags/$tag.tar.gz"
    mkdir -p "$tmp/tag"
    tar -xzf "$tmp/tag.tar.gz" -C "$tmp/tag"
    local top
    top="$(find "$tmp/tag" -mindepth 1 -maxdepth 1 -type d | head -1)"
    [ -n "$top" ] || die "empty tag tarball"
    site="$tmp/site"
    mkdir -p "$site"
    cp "$top/releases/SoulStream.apk" "$site/SoulStream.apk" ||
      die "tag has no releases/SoulStream.apk"
    cp "$top/showcase/index.html" "$site/index.html" ||
      die "tag has no showcase/index.html"
    cp "$top/showcase/qr.png" "$site/qr.png" || true
    cp -a "$top/showcase/img" "$site/img" ||
      die "tag has no showcase/img"
    create_source_zip "$top" "$site/SoulStream-source.zip"
    write_sha_sums "$site"
    local pkg_version version_code
    pkg_version="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["version"])' "$top/package.json")"
    version_code="$(grep -oP 'versionCode\s+\K[0-9]+' "$top/android/app/build.gradle" | head -1 || echo 0)"
    apk_sha="$(sha256sum "$site/SoulStream.apk" | awk '{print $1}')"
    cat > "$site/release.json" <<EOF
{"tag":"$tag","version":"$pkg_version","versionCode":$version_code,"apk_sha256":"$apk_sha","built_at":"$(date -u +%FT%TZ)"}
EOF
  fi

  if [ "$DRY_RUN" = 1 ]; then
    log "DRY: would deploy $tag from $site to $SITE_DIR"
    find "$site" -maxdepth 2 -type f -printf 'DRY:   %P\n' | sort
    return 0
  fi

  local backup
  mkdir -p "$HOME/backups"
  backup="$HOME/backups/streaming-$(date -u +%Y%m%dT%H%M%SZ)"
  if [ -d "$SITE_DIR" ]; then
    cp -a "$SITE_DIR" "$backup"
    log "deploy: backup $backup"
  fi

  if [ "${SKIP_SUDO:-0}" = 1 ]; then
    mkdir -p "$SITE_DIR/img"
    install -m 644 "$site/SoulStream.apk" "$site/SoulStream-source.zip" "$site/index.html" "$site/qr.png" "$site/SHA256SUMS.txt" "$SITE_DIR/"
    cp -a "$site/img/." "$SITE_DIR/img/"
  else
    sudo install -d -m 755 -o www-data -g www-data "$SITE_DIR/img"
    sudo install -m 644 -o www-data -g www-data \
      "$site/SoulStream.apk" "$site/SoulStream-source.zip" "$site/index.html" \
      "$site/qr.png" "$site/SHA256SUMS.txt" "$SITE_DIR/"
    sudo cp -a "$site/img/." "$SITE_DIR/img/"
    sudo chown -R www-data:www-data "$SITE_DIR/img"
  fi

  local installed_sha expected_sha
  installed_sha="$(sha256sum "$SITE_DIR/SoulStream.apk" | awk '{print $1}')"
  expected_sha="$(sha256sum "$site/SoulStream.apk" | awk '{print $1}')"
  [ "$installed_sha" = "$expected_sha" ] || die "installed APK hash mismatch"
  if [ "${SKIP_CHANGELOG:-0}" != 1 ]; then
    printf '%s - %s - %s\n' "$(date -u +%FT%TZ)" "soulstream-automation" \
      "deployed SoulStream $tag to $SITE_DIR (APK sha256 $installed_sha)" \
      >> "$HOME/AGENT_CHANGELOG.md" 2>/dev/null || true
  fi
  log "deploy: $tag installed (APK sha256 $installed_sha)"
}

deploy_bundle() {
  local bundle="$1" tag tmp site backup installed_sha expected_sha
  [ -f "$bundle" ] || die "bundle not found: $bundle"
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' RETURN
  python3 -m zipfile -e "$bundle" "$tmp/site"
  site="$tmp/site"
  [ -f "$site/SoulStream.apk" ] || die "bundle has no APK"
  [ -f "$site/index.html" ] || die "bundle has no index.html"
  [ -f "$site/qr.png" ] || die "bundle has no qr.png"
  [ -f "$site/SoulStream-source.zip" ] || die "bundle has no source ZIP"
  [ -f "$site/SHA256SUMS.txt" ] || die "bundle has no SHA256SUMS.txt"
  [ -d "$site/img" ] || die "bundle has no img/"
  ( cd "$site" && sha256sum -c SHA256SUMS.txt >/dev/null ) || die "bundle checksum mismatch"
  if [ -z "$TAG_ARG" ]; then
    tag="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("tag",""))' "$site/release.json" 2>/dev/null || true)"
  else
    tag="$TAG_ARG"
  fi
  [ -n "$tag" ] || die "bundle has no tag; pass --tag"
  if [ "$DRY_RUN" = 1 ]; then
    log "DRY: would deploy bundle $bundle ($tag) to $SITE_DIR"
    find "$site" -maxdepth 2 -type f -printf 'DRY:   %P\n' | sort
    return 0
  fi
  mkdir -p "$HOME/backups"
  backup="$HOME/backups/streaming-$(date -u +%Y%m%dT%H%M%SZ)"
  if [ -d "$SITE_DIR" ]; then
    cp -a "$SITE_DIR" "$backup"
    log "deploy-bundle: backup $backup"
  fi
  if [ "${SKIP_SUDO:-0}" = 1 ]; then
    mkdir -p "$SITE_DIR/img"
    install -m 644 "$site/SoulStream.apk" "$site/SoulStream-source.zip" "$site/index.html" "$site/qr.png" "$site/SHA256SUMS.txt" "$SITE_DIR/"
    cp -a "$site/img/." "$SITE_DIR/img/"
  else
    sudo install -d -m 755 -o www-data -g www-data "$SITE_DIR/img"
    sudo install -m 644 -o www-data -g www-data \
      "$site/SoulStream.apk" "$site/SoulStream-source.zip" "$site/index.html" \
      "$site/qr.png" "$site/SHA256SUMS.txt" "$SITE_DIR/"
    sudo cp -a "$site/img/." "$SITE_DIR/img/"
    sudo chown -R www-data:www-data "$SITE_DIR/img"
  fi
  installed_sha="$(sha256sum "$SITE_DIR/SoulStream.apk" | awk '{print $1}')"
  expected_sha="$(sha256sum "$site/SoulStream.apk" | awk '{print $1}')"
  [ "$installed_sha" = "$expected_sha" ] || die "installed APK hash mismatch"
  if [ "${SKIP_CHANGELOG:-0}" != 1 ]; then
    printf '%s - %s - %s\n' "$(date -u +%FT%TZ)" "soulstream-automation" \
      "deployed SoulStream $tag from local bundle to $SITE_DIR (APK sha256 $installed_sha)" \
      >> "$HOME/AGENT_CHANGELOG.md" 2>/dev/null || true
  fi
  state_set_release "$tag"
  log "deploy-bundle: $tag installed (APK sha256 $installed_sha)"
}

# --------------------------------------------------------------- modes ------

check_mode() {
  local tag
  tag="$(latest_tag || die "cannot reach GitHub API")"
  log "latest release: ${tag:-none}"
  release_json_latest | release_summary | awk -F'\t' '$1 == "ASSET" {printf "  asset: %s (%s bytes)\n", $2, $5}' | tee -a "$LOG_FILE"
  log "remote branches:"
  branch_tips | while IFS=$'\t' read -r b s; do log "  $b $s"; done
  if [ -f "$STATE_FILE" ]; then
    log "state release: $(state_get_release)"
    log "state branches:"
    python3 - "$STATE_FILE" <<'PY' | while IFS=$'\t' read -r b s; do log "  $b $s"; done
import json, sys
with open(sys.argv[1]) as f:
    for b, s in sorted((json.load(f).get("branches") or {}).items()):
        print(f"{b}\t{s}")
PY
  else
    log "no state yet; watch will initialize at the latest release"
  fi
}

watch_mode() {
  mkdir -p "$AUTOMATION_DIR"
  exec 9>"$LOCK_FILE"
  if ! flock -n 9; then
    log "watch: another run is active; skipping"
    return 0
  fi

  if [ ! -f "$STATE_FILE" ]; then
    local initial
    initial="$(state_init || true)"
    log "watch: initialized at release ${initial:-none}"
    return 0
  fi

  local tips changes branch old new ccr_branch ccr_tip
  tips="$(mktemp)"
  branch_tips > "$tips" || die "cannot list remote branches"
  changes="$(compare_branches "$tips")"
  rm -f "$tips"

  while IFS=$'\t' read -r kind branch old new; do
    [ "$kind" = "CHANGED" ] || continue
    log "branch changed: $branch ${old:-<new>} -> $new"
    if [ "${branch#ccr-}" != "$branch" ]; then
      ccr_branch="$branch"
      ccr_tip="$new"
    fi
  done <<< "$changes"

  if [ -n "${ccr_branch:-}" ] && [ -n "${TRIGGER_BUILD_CMD:-}" ]; then
    log "watch: triggering build host for $ccr_branch@$ccr_tip"
    TRIGGER_BRANCH="$ccr_branch" TRIGGER_TIP="$ccr_tip" \
      timeout 1800 bash -c "$TRIGGER_BUILD_CMD" >> "$LOG_FILE" 2>&1 ||
      log "watch: build trigger failed"
  elif [ -n "${ccr_branch:-}" ]; then
    log "watch: new branch $ccr_branch needs a build on the workstation (no build toolchain on VPS)"
  fi

  local latest current
  latest="$(latest_tag || true)"
  current="$(state_get_release)"
  if [ -z "$latest" ]; then
    log "watch: no releases found"
    return 0
  fi
  if [ "$latest" = "$current" ]; then
    log "watch: release $latest already current"
    return 0
  fi
  if [ -n "$current" ] && \
     [ "$(printf '%s\n%s\n' "$current" "$latest" | sort -V | tail -1)" != "$latest" ]; then
    log "watch: latest release $latest is older than state $current; not downgrading"
    return 0
  fi
  log "watch: new release $latest (was ${current:-none})"
  deploy_release "$latest"
  state_set_release "$latest"
}

install_timer() {
  if [ "$ASSUME_YES" != 1 ]; then
    echo "This installs /etc/systemd/system/soulstream-watch.{service,timer} and enables a 15-minute timer."
    echo "Re-run with --yes to continue."
    exit 1
  fi
  local script_path user group
  script_path="$AUTOMATION_DIR/automation.sh"
  mkdir -p "$AUTOMATION_DIR"
  if [ "$(readlink -f "$0")" != "$(readlink -f "$script_path" 2>/dev/null || true)" ]; then
    install -m 755 "$0" "$script_path"
  fi
  if [ ! -f "$AUTOMATION_DIR/config.env" ]; then
    cat > "$AUTOMATION_DIR/config.env" <<EOF
SITE_DIR=$SITE_DIR
WEB_URL=$WEB_URL
REPO_SLUG=$REPO_SLUG
REPO_URL=$REPO_URL
# Optional: command run when a ccr-* branch changes, e.g.
# TRIGGER_BUILD_CMD='ssh build-host /path/to/tools/automation.sh build'
EOF
  fi
  user="$(id -un)"
  group="$(id -gn)"
  sudo tee /etc/systemd/system/soulstream-watch.service >/dev/null <<EOF
[Unit]
Description=SoulStream release watcher and deployer
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
User=$user
Group=$group
Environment=HOME=$HOME
ExecStart=$script_path watch
Nice=19
IOSchedulingClass=idle
EOF
  sudo tee /etc/systemd/system/soulstream-watch.timer >/dev/null <<EOF
[Unit]
Description=Check SoulStream branches and releases every 15 minutes

[Timer]
OnBootSec=5min
OnUnitActiveSec=15min
RandomizedDelaySec=30
Persistent=true

[Install]
WantedBy=timers.target
EOF
  sudo systemctl daemon-reload
  sudo systemctl enable --now soulstream-watch.timer
  log "installed soulstream-watch.timer (user $user)"
  systemctl list-timers soulstream-watch.timer --no-pager || true
}

# --------------------------------------------------------------- build ------

require_clean() {
  [ -z "$(git status --porcelain)" ] || die "working tree is not clean"
}

ensure_build_env() {
  command -v git >/dev/null || die "git missing"
  command -v node >/dev/null || die "node missing"
  command -v npm >/dev/null || die "npm missing"
  command -v java >/dev/null || die "java missing"
  command -v "$GH_BIN" >/dev/null || die "gh missing"
  [ -d "${ANDROID_HOME:-$HOME/Android/Sdk}" ] || die "Android SDK missing (ANDROID_HOME)"
  git remote get-url origin >/dev/null 2>&1 || die "no origin remote"
  "$GH_BIN" auth status >/dev/null 2>&1 || die "gh is not authenticated"
  [ -d node_modules ] || npm ci
}

newest_branch() {
  local line ref
  while IFS= read -r line; do
    ref="${line#*$'\t'}"
    if [[ "$ref" == origin/ccr-* ]] && ! git merge-base --is-ancestor "$ref" main; then
      printf '%s\n' "$ref"
      return 0
    fi
  done < <(git for-each-ref --sort=-committerdate \
      --format='%(committerdate:unix)%09%(refname:short)' refs/remotes/origin)
  return 1
}

restore_readme_license() {
  local saved="$1"
  python3 - "$saved" README.md <<'PY'
import sys
saved, target = sys.argv[1], sys.argv[2]
try:
    src = open(saved).read()
    rest = open(target).read()
except FileNotFoundError:
    sys.exit(0)
marker = "\n## Licence\n"
if marker not in src:
    sys.exit(0)
licence = marker + src.split(marker, 1)[1]
if marker not in rest:
    open(target, "a").write("\n" + licence)
PY
}

prepare_showcase() {
  local version="$1"
  python3 - "$version" showcase/index.html <<'PY'
import re, sys
version, path = sys.argv[1], sys.argv[2]
s = open(path).read()
s = re.sub(r'<!-- One QR symbol.*?</svg>\n\n', '', s, count=1, flags=re.S)
s = s.replace(
    '<svg role="img" aria-label="QR code vers l\'APK de développement"><use href="#qr"/></svg>',
    '<img src="qr.png" alt="QR code vers l\'APK SoulStream">')
s = s.replace(
    '<div class="mini-qr"><svg role="img" aria-label="QR code de téléchargement"><use href="#qr"/></svg></div>',
    '<div class="mini-qr"><img src="qr.png" alt="QR code de téléchargement"></div>')
s = s.replace('.qr-frame svg { display: block; width: 100%; height: 100%; }',
              '.qr-frame img { display: block; width: 100%; height: 100%; object-fit: contain; }')
s = s.replace('.closing .mini-qr svg { display: block; width: 100%; height: auto; }',
              '.closing .mini-qr img { display: block; width: 100%; height: auto; }')
s = re.sub(
    r'<a class="btn" href="https://github\.com/Thibaut-Fontaine/soulseek-streaming">.*?</a>',
    '''<a class="btn" href="SoulStream-source.zip">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12m0 0l-4-4m4 4l4-4M5 21h14"/></svg>
          Code source (.zip)
        </a>''',
    s, count=1, flags=re.S)
s = s.replace("L'APK se télécharge depuis GitHub : connectez-vous avec un compte qui a accès au dépôt.",
              "L'APK se télécharge directement depuis thibautfontaine.space, sans compte ni connexion.")
s = s.replace('Sans télémétrie', 'Catalogue Deezer')
s = s.replace('sans catalogue central', 'sans catalogue de fichiers')
s = s.replace('ne fournit aucun catalogue ni', 'ne fournit aucun fichier ni')
s = re.sub(r'(<span class="pill">)v[0-9.]+(</span>)', rf'\g<1>v{version}\g<2>', s, count=1)
if '<span class="pill">v' not in s:
    s = s.replace('<div class="tags">', f'<div class="tags">\n        <span class="pill">v{version}</span>', 1)
s = re.sub(r'Version [0-9]+\.[0-9]+\.[0-9]+', f'Version {version}', s)
if 'src="qr.png"' not in s or 'build:info' not in s or 'data-build="apk-link"' not in s:
    sys.exit("showcase/index.html is not compatible with tools/showcase.mjs")
open(path, 'w').write(s)
PY
}

bump_version() {
  local old new old_code new_code new_name
  old="$(node -p "require('./package.json').version")"
  if [ -n "$VERSION_ARG" ]; then
    new="$VERSION_ARG"
  else
    new="$(python3 - "$old" <<'PY'
import sys
parts = (sys.argv[1].split(".") + ["0", "0", "0"])[:3]
print(f"{int(parts[0])}.{int(parts[1]) + 1}.0")
PY
)"
  fi
  [[ "$new" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "invalid version: $new"
  old_code="$(grep -oP 'versionCode\s+\K[0-9]+' android/app/build.gradle | head -1)"
  new_code=$((old_code + 1))
  new_name="${new%.*}"
  log "bump: $old -> $new (versionCode $old_code -> $new_code, versionName $new_name)"
  npm version "$new" --no-git-tag-version >/dev/null
  python3 - "$new_code" "$new_name" <<'PY'
import re, sys
code, name = sys.argv[1], sys.argv[2]
p = 'android/app/build.gradle'
s = open(p).read()
s = re.sub(r'versionCode\s+\d+', f'versionCode {code}', s, count=1)
s = re.sub(r'versionName\s+"[^"]*"', f'versionName "{name}"', s, count=1)
open(p, 'w').write(s)
PY
  python3 - "$new" <<'PY'
import re, sys
version = sys.argv[1]
p = 'README.md'
s = open(p).read()
s = re.sub(r'### Build actuelle \([^)]*\)', f'### Build actuelle ({version})', s, count=1)
s = re.sub(r'La version [0-9.]+ publiée', f'La version {version} publiée', s, count=1)
open(p, 'w').write(s)
PY
  prepare_showcase "$new"
  VERSION="$new"
  VERSION_CODE="$new_code"
}

build_mode() {
  local root app branch pre_head conflicts f saved_readme tmp apk sha short site source_zip
  root="$(git rev-parse --show-toplevel)"
  cd "$root"
  ensure_build_env
  require_clean
  git fetch origin --prune --tags
  branch="${BRANCH_ARG:-}"
  if [ -z "$branch" ]; then
    branch="$(newest_branch || true)"
    if [ -z "$branch" ]; then
      log "build: no unmerged ccr-* branch; nothing to do"
      return 0
    fi
  fi
  [[ "$branch" == origin/* ]] || branch="origin/$branch"
  git rev-parse --verify "$branch" >/dev/null || die "unknown branch: $branch"
  if git merge-base --is-ancestor "$branch" main; then
    log "build: $branch is already merged into main; nothing to do"
    return 0
  fi

  pre_head="$(git rev-parse HEAD)"
  saved_readme="$(mktemp)"
  git show "$pre_head:README.md" > "$saved_readme" 2>/dev/null || true
  log "build: merging $branch into main"
  if ! git merge --no-ff "$branch" -m "merge: $branch"; then
    conflicts="$(git diff --name-only --diff-filter=U || true)"
    log "build: conflicts: ${conflicts:-unknown}"
    for f in $conflicts; do
      case "$f" in
        README.md)
          git checkout --theirs README.md
          restore_readme_license "$saved_readme"
          ;;
        showcase/index.html|releases/SoulStream.apk)
          git checkout --theirs "$f"
          ;;
        *)
          git merge --abort || true
          rm -f "$saved_readme"
          die "unresolved conflict in $f; resolve manually"
          ;;
      esac
    done
    git add -A
    git commit --no-edit
  fi
  rm -f "$saved_readme"

  log "build: running tests"
  if ! npm test -- --runInBand >> "$LOG_FILE" 2>&1; then
    git reset --hard "$pre_head"
    die "tests failed; local main reset to $pre_head"
  fi
  if ! npm run typecheck >> "$LOG_FILE" 2>&1; then
    git reset --hard "$pre_head"
    die "typecheck failed; local main reset to $pre_head"
  fi
  if ! npm run lint >> "$LOG_FILE" 2>&1; then
    git reset --hard "$pre_head"
    die "lint failed; local main reset to $pre_head"
  fi

  bump_version
  git add -A
  git commit -q -m "chore: prepare $VERSION release"
  log "build: building APK ($ANDROID_ARCHS)"
  if ! ( cd android && ./gradlew assembleRelease --no-daemon \
      -PreactNativeArchitectures="$ANDROID_ARCHS" >> "$LOG_FILE" 2>&1 ); then
    git reset --hard "$pre_head"
    die "Gradle build failed; local main reset to $pre_head"
  fi
  apk="android/app/build/outputs/apk/release/app-release.apk"
  [ -f "$apk" ] || { git reset --hard "$pre_head"; die "APK not found"; }
  sha="$(sha256sum "$apk" | awk '{print $1}')"
  short="${sha:0:8}"
  log "build: APK $VERSION sha256=$sha"

  node tools/showcase.mjs "$apk" --url "$WEB_URL/SoulStream.apk?v=$VERSION-$short"
  git add releases/SoulStream.apk showcase/index.html showcase/qr.png
  git commit -q -m "build: publish $VERSION APK with QR"
  VERSION_CODE="$(grep -oP 'versionCode\s+\K[0-9]+' android/app/build.gradle | head -1)"

  tmp="$(mktemp -d)"
  site="$tmp/site"
  mkdir -p "$site/img"
  cp "$apk" "$site/SoulStream.apk"
  cp showcase/index.html "$site/index.html"
  cp showcase/qr.png "$site/qr.png"
  cp -a showcase/img/. "$site/img/"
  create_source_zip "$root" "$site/SoulStream-source.zip"
  write_sha_sums "$site"
  cat > "$site/release.json" <<EOF
{"tag":"v$VERSION","version":"$VERSION","versionCode":$VERSION_CODE,"apk_sha256":"$sha","built_at":"$(date -u +%FT%TZ)"}
EOF
  source_zip="$site/SoulStream-source.zip"
  ( cd "$site" && zip -qr "$tmp/SoulStream-site-$VERSION.zip" . )
  log "build: site bundle $tmp/SoulStream-site-$VERSION.zip"

  if [ "$NO_PUSH" = 0 ]; then
    log "build: pushing main"
    git push origin main
    cp "$apk" "$tmp/SoulStream-$VERSION.apk"
    cat > "$tmp/notes.md" <<EOF
# SoulStream $VERSION

Merged branch \`$branch\`.

## Changes

$(git log --oneline "$pre_head..$branch" | head -60)

## APK

- Version: **$VERSION** (\`versionCode $VERSION_CODE\`)
- Android 7.0+ (API 24)
- ABIs: \`$ANDROID_ARCHS\`
- Debug-signed test build
- SHA-256: \`$sha\`
- Site: $WEB_URL/

## Licence

MIT — Copyright (c) 2026 Thibaut Fontaine. See LICENSE and NOTICE.
EOF
    log "build: creating GitHub release v$VERSION"
    "$GH_BIN" release create "v$VERSION" "$tmp/SoulStream-$VERSION.apk" \
      "$tmp/SoulStream-site-$VERSION.zip" \
      --repo "$REPO_SLUG" --target main \
      --title "SoulStream $VERSION" --notes-file "$tmp/notes.md"
    log "build: release v$VERSION published"
    if [ -n "${VPS_HOST:-}" ] && [ "${TRIGGER_VPS:-1}" = 1 ]; then
      log "build: triggering VPS watcher on $VPS_HOST"
      ssh "$VPS_HOST" "$AUTOMATION_DIR/automation.sh watch" >> "$LOG_FILE" 2>&1 ||
        log "build: VPS trigger failed; the timer will retry"
    fi
  else
    log "build: --no-push; local commits and bundle left in $tmp"
  fi
}

case "$MODE" in
  help) usage ;;
  check) check_mode ;;
  watch) watch_mode ;;
  deploy)
    if [ -n "$BUNDLE_ARG" ]; then
      deploy_bundle "$BUNDLE_ARG"
    else
      [ -n "$TAG_ARG" ] || die "deploy needs --tag vX.Y.Z or --bundle file.zip"
      deploy_release "$TAG_ARG"
      state_set_release "$TAG_ARG"
    fi
    ;;
  install-timer) install_timer ;;
  build) build_mode ;;
  *) usage; exit 1 ;;
esac
