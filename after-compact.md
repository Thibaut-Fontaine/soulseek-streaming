# SoulStream — after-compact handoff

Last updated: **2026-10-25**. Read this first after a context compaction, together
with the repository's **`AGENTS.md`** (project rules, architecture, commands —
the source of truth shared by every agent), the global agent rules
(`~/agents-rules/AGENTS-GLOBAL.md`) and the VPS host rules
(`ssh vps-ovh 'cat ~/AGENTS.md'`). This file keeps what is specific to the
owner's workstation and VPS, plus history; when it disagrees with `AGENTS.md`,
`AGENTS.md` wins.

> **Update 2026-10-25 (branch `ccr-2c144a4c-rqe6bc`, version 1.3-beta2,
> versionCode 5):** online catalog (Deezer) with unified search results,
> artist/album pages, similar artists and a home page built only from the
> listening history; search no longer auto-plays (the user taps a result).
> Sections below still describe 0.2.0 where not updated; see `AGENTS.md`
> and `docs/unified-catalog-research.md` / `docs/catalog-ui-design.md`.

---

## 1. What this project is

**SoulStream** is a React Native (iOS/Android) Soulseek client in
`/home/thibaut/soulseek-streaming`.

- It logs in to the official Soulseek server, searches the P2P network, queues a
  file, receives it from a peer, and streams it through a local HTTP Range proxy
  into `react-native-track-player`.
- **MP3 only** by design. The search filters out every other format and the
  transfer layer refuses non-MP3.
- **One-tap UX**: type a title, the query is cleaned locally, incoming results
  are ranked with Levenshtein scoring, and the best source starts playing in the
  background. A sources list and manual fallback are available, but the main
  flow stays on the simple search screen.
- **Sharing is now implemented** (version 0.2.0): tracks already played are
  cached on the device and offered to other users; MP3s can also be imported
  from the phone. Sharing is a client feature, not an account flag.
- Version **0.2.0**, versionCode **2**, signed with the Android debug key.

---

## 2. Where everything lives

| Item | Value |
| --- | --- |
| Local project | `/home/thibaut/soulseek-streaming` |
| GitHub (private) | https://github.com/Thibaut-Fontaine/soulseek-streaming |
| GitHub collaborator | `CallaoVinicius`, permission `write` |
| Public page | https://thibautfontaine.space/streaming/ |
| Public APK | https://thibautfontaine.space/streaming/SoulStream.apk |
| Public source ZIP | https://thibautfontaine.space/streaming/SoulStream-source.zip |
| VPS files | `/var/www/thibautfontaine.space/streaming/` |
| VPS service | existing `nginx`, **no nginx config change needed** |
| Latest APK SHA-256 | `cba1926f1ce22c9a7f109e40dabddf44cc6338a71ee609e43ee1fa728258959b` |
| APK size | `59 521 454` bytes (59,5 Mo) |
| APK version | `0.2.0` / versionCode `2` |
| APK ABIs | `arm64-v8a`, `armeabi-v7a`, `x86`, `x86_64` |
| APK signing | Android **debug keystore** |
| APK code commit | `4581fb6 chore: release 0.2.0 with sharing, fallback and new UI` |
| Showcase/build commit | `d769511 build: publish 0.2.0 APK, showcase page and QR code` |
| Merge commit | `05b3fb9 merge: newest SoulStream build (...)` |

The source ZIP does **not** contain the 59,5 Mo APK or build outputs. Its
SHA-256 is in the public `SHA256SUMS.txt`; do not hard-code it in this file
(it changes when the ZIP is rebuilt).

Branches `ccr-6614f5a9-h2u4fa` and `ccr-b56e6780-ko4xxa` (work by Claude) were
reviewed and merged into `main`; both are fully contained in `main`.
`ccr-b56e6780-ko4xxa` added sharing, source fallback, the redesigned UI, the
debug journal, search fixes, and the first QR showcase.

---

## 3. Current app behaviour (verified on Android 15 emulator)

- Auto-login with credentials stored in Android Keystore/Keychain.
- Search screen “Rechercher”:
  - one input, one **Écouter** button, **Arrêter** while searching;
  - results appear under **Meilleure source** and **Morceaux**;
  - a good match auto-plays after a short 1.2 s collection window;
  - search closes 4 s after the match so fallback sources are available;
  - no convincing result: “Aucun MP3 convaincant” + Relancer.
- Search maximum: 10 s. Late `FileSearchResponse`s are dropped before zlib
  inflation once the search is closed.
- **Short-preview penalty**: a result shorter than 45 s loses 0.35 of its match
  score. This is why the default 28 s fake demo is rejected; use a longer file
  and `DURATION=300` for auto-play tests.
- **Source fallback**: if a peer refuses, queues, or does not answer, the next
  ranked source is tried automatically (up to 5).
- **Track cache**: finished downloads are kept on the device (default 1 GiB,
  least-recently-used eviction) and can be played locally without network.
- **Sharing**: cached tracks are announced to the server and can be uploaded;
  **Réglages → Partage** also imports MP3s from the phone. One upload slot,
  Wi-Fi-only by default. `shareEnabled` defaults to `true`.
- Playback preparation is asynchronous; tabs remain usable while a track loads.
  The mini player has a `×` to cancel preparation.
- New **Réglages** sections: reading buffer, sharing, cache, network, debug
  journal (`Journal`).
- The app does **not** join the distributed search tree; shared files are
  browsable/downloadable but do not appear in other users' searches.
- No obfuscated peer connections yet.

---

## 4. Recent fixes/features — do not regress

> This list stops at 0.2.0. Later fixes and the mistakes behind them are in
> `AGENTS.md` → "Pitfalls already hit" and `docs/performance-audit.md`.

1. **Overlapping searches / blank UI** (`fef33bd`): per-search timers,
   cancellation, ErrorBoundary.
2. **MP3-only** (`fef33bd`): `STREAMABLE_EXTENSIONS = new Set(['mp3'])` in
   `src/core/types.ts`; enforced in the search parser and `createTransfer`.
3. **One-tap Levenshtein auto-play** (`b9e843c`): query formatting, bounded
   Levenshtein, token-order-insensitive scoring, quality/availability ranking.
4. **UI freeze while loading** (`4209457`):
   - late search responses dropped **before pako inflation** when no active
     search;
   - search response caps: **512 KiB compressed / 4 MiB inflated / 500 files /
     200 hits**;
   - `RangeHttpServer` yields to the event loop every 2 × 64 KiB;
   - mini-player `×` cancels preparation.
5. **Sharing + fallback + redesign** (merged `05b3fb9`):
   - `src/core/uploads.ts`: `QueueUpload`, `TransferRequest/Response`,
     `FileTransferInit`, upload slots, queue, timeouts;
   - `src/services/trackCache.ts`: 1 GiB LRU cache, sharing library, local
     playback;
   - `src/services/debugLog.ts`: in-app journal;
   - `src/ui/p2p.ts`, `peer.tsx`: source list/peer display;
   - Android document picker import in Settings;
   - new UI components/theme/icon set.
6. **Version 0.2.0 + QR page** (`d769511`):
   - versionCode 2 / versionName 0.2.0;
   - showcase page now uses a **PNG QR** (`showcase/qr.png`, 600×600, margin 4,
     error correction H) generated by `tools/showcase.mjs`;
   - the QR decodes to `https://thibautfontaine.space/streaming/SoulStream.apk`
     even with the centered app icon overlay (verified with `jsQR`);
   - do not go back to the inline SVG QR: ImageMagick/rendering made it
     unreliable; the PNG is verified.
7. **Lint/type clean**: 104 tests / 11 suites, `tsc --noEmit` clean, ESLint
   0 errors (warnings only).

Regression tests: `bytes`, `client`, `httpServer`, `protocol`, `search`,
`store`, `streamDebug`, `trackCache`, `uploads`, `uiErrors`, `uiModel`.

---

## 5. Architecture / key files

```
src/core/
  bytes.ts            little-endian helpers, UTF-8, ByteQueue
  framer.ts           TCP framing
  protocol.ts         codes, encoders/parsers, zlib search responses
  soulseekClient.ts   server + P/F connections, searches, transfers, shares
  chunkBuffer.ts      append-only buffer with progressive waitFor
  transfer.ts         download/stream state machine
  uploads.ts          upload manager for shared files
  search.ts           query formatter, Levenshtein, ranking/availability
  types.ts            SearchHit, MP3-only policy, helpers
src/services/
  streaming.ts        orchestration, owns client + HTTP server
  settings.ts         AsyncStorage settings + Keychain credentials
  trackCache.ts       downloaded-track LRU cache + sharing library
  debugLog.ts         in-app journal (also console)
  blobUtilFs.ts       react-native-blob-util file-system adapter
src/stream/httpServer.ts   HTTP Range proxy -> TrackPlayer
src/state/store.ts         zustand store (search, playback, fallback, cache)
src/ui/                    Login/Search/Player/Settings/MiniPlayer/TabBar
                           components/theme/icons/peer/sources/errors
src/player/                TrackPlayer setup + background service
tools/fake-network.ts      dev fake Soulseek server + peer
tools/showcase.mjs         APK -> releases/ + showcase page + QR
tools/demo.mp3             28 s / 217 KB test MP3
patches/react-native-track-player+4.1.2.patch   Kotlin nullability fix
showcase/                  public landing page + screenshots + qr.png
releases/SoulStream.apk    built APK (59,5 Mo; also on the VPS)
```

Native config:

- `android/gradle.properties`: `newArchEnabled=false` (TrackPlayer 4.1.2 is not
  TurboModule-compliant).
- `ios/Podfile`: `:new_arch_enabled => false`.
- `network_security_config.xml`: cleartext only for `127.0.0.1`/`localhost`.
- `AndroidManifest.xml`: `POST_NOTIFICATIONS`, network security config.
- `Info.plist`: background audio, local networking description.
- `index.js`: registers the TrackPlayer playback service.
- New native deps: `@react-native-community/netinfo`,
  `@react-native-documents/picker`, `react-native-blob-util`,
  `react-native-linear-gradient`, `react-native-svg` (autolinked).

---

## 6. Build, test, run

```bash
cd /home/thibaut/soulseek-streaming

npm ci                      # applies patches/ via patch-package
npm test                    # 104 tests / 11 suites
npm run typecheck
npm run lint                # 0 errors, warnings only

# Android release APK (deployed build)
cd android
./gradlew assembleRelease --no-daemon \
  -PreactNativeArchitectures=arm64-v8a,armeabi-v7a,x86_64
# -> android/app/build/outputs/apk/release/app-release.apk

adb install -r android/app/build/outputs/apk/release/app-release.apk
```

- The build also produced `x86`; all four ABIs are in the APK. It took ~9 min
  on this workstation.
- The APK is signed with the template debug key; not Play-Store ready.
- Do not commit `node_modules`, `android/build`, `android/app/build`,
  `android/app/.cxx`, `ios/Pods`, `android/local.properties`, `.git`.
- iOS was never built here (Linux host).

---

## 7. Emulator + fake network

AVD: `SoulStream_API35` (Android 15, 720×1280, API 35, x86_64), package
`com.soulstream.app`. The emulator keeps the `test` / `test` fake credentials
and the `10.0.2.2:22420` server setting across installs.

```bash
~/Android/Sdk/emulator/emulator -avd SoulStream_API35 \
  -no-window -no-audio -no-boot-anim -gpu swiftshader_indirect -no-snapshot

adb wait-for-device
adb shell getprop sys.boot_completed   # expect 1
adb forward tcp:22345 tcp:22345

# Fake server + peer, from the repo root.
# Use an absolute FILE path and a duration >= 45 s: the app rejects previews.
FILE=/tmp/opencode/demo-long.mp3 DURATION=300 npx tsx tools/fake-network.ts
```

Fake server env:

- `FILE=/absolute/path.mp3` (default `tools/demo.mp3`, 28 s — rejected by the
  short-preview penalty);
- `DURATION=300` (advertised duration; default 28);
- `SERVER_PORT=22420`, `PEER_PORT=22421`, `PEER_IP=10.0.2.2`,
  `CLIENT_PORT=22345`;
- `ACCEPT_DELAY_MS=4000`, `CHUNK_DELAY_MS=1500` (default 0 and 5): a slow
  peer, to test what happens while a track loads (cancel, tabs, fallback);
- `ECHO=1`: every search gets one file named after the query, so catalog
  tracks (searched as artist + title when played) find a source;
- `PEERS=bob:12,carol:20` (default `alice`): several peers sharing the same
  files, one port each from `PEER_PORT` (`adb reverse` each one); `name:N`
  keeps you queued at position N and never sends the file;
- `RESULT_CONN_MS=600000` (default 5000): how long the peer keeps the
  connection it delivered results on (the app reuses it for the download).

The fake hits are now `Music\Fake Artist\Fake Album\0N - Fake Song N.mp3`.
Search **`Fake Song 1`** (not just `Fake`) to get a high enough score for
auto-play. The old `Fake` query lists sources but may not auto-play.

Tested on the emulator:

- auto-play of “Fake Song 1” with `DURATION=300` and a 2.3 MB / 5 min MP3;
- transfer completed, playback started, mini player active;
- switching to **Réglages** and back during preparation/playback works (the
  first injected tap can occasionally be dropped during a fallback transition;
  retry once);
- all-ABI APK installs and runs on the x86_64 emulator.

To generate a long test MP3 if `/tmp/opencode` was wiped:

```bash
gst-launch-1.0 -q audiotestsrc freq=440 num-buffers=13000 \
  ! audio/x-raw,rate=44100,channels=1 \
  ! lamemp3enc target=bitrate bitrate=192 \
  ! filesink location=/tmp/opencode/demo-long.mp3
```

---

## 8. Website / QR / deployment

The public page is the **`showcase/`** page, not the old hand-written page:

- `showcase/index.html` → deployed as `/streaming/index.html`
- `showcase/qr.png` → `/streaming/qr.png` (600×600 PNG, quiet zone 4)
- `showcase/img/*` → `/streaming/img/*` (icon, login, player, search)
- `SoulStream.apk`, `SoulStream-source.zip`, `SHA256SUMS.txt` at `/streaming/`

The QR encodes exactly:

```
https://thibautfontaine.space/streaming/SoulStream.apk
```

It was verified with `jsQR` both alone and with the centered app icon overlay.
The QR card and both download links are absolute VPS URLs; the source button
points to the local `SoulStream-source.zip`.

Regenerate page + QR after a new build:

```bash
# Commit app changes first: the script refuses a dirty app tree.
node tools/showcase.mjs android/app/build/outputs/apk/release/app-release.apk \
  --url https://thibautfontaine.space/streaming/SoulStream.apk
# writes releases/SoulStream.apk, showcase/index.html, showcase/qr.png
git add releases showcase && git commit -m "build: refresh APK and QR"
```

Deploy (back up first):

```bash
ssh vps-ovh 'cp -a /var/www/thibautfontaine.space/streaming \
  /home/ubuntu/backups/streaming-$(date -u +%Y%m%dT%H%M%SZ)'

# Stage a fresh dir; never scp directly into /var/www.
ssh vps-ovh 'mkdir -p /home/ubuntu/soulstream-uploadN'
scp -r SoulStream.apk SoulStream-source.zip index.html qr.png img \
  SHA256SUMS.txt vps-ovh:/home/ubuntu/soulstream-uploadN/

ssh vps-ovh 'sudo install -m 644 -o www-data -g www-data \
  /home/ubuntu/soulstream-uploadN/SoulStream.apk \
  /home/ubuntu/soulstream-uploadN/SoulStream-source.zip \
  /home/ubuntu/soulstream-uploadN/index.html \
  /home/ubuntu/soulstream-uploadN/qr.png \
  /home/ubuntu/soulstream-uploadN/SHA256SUMS.txt \
  /var/www/thibautfontaine.space/streaming/ && \
  sudo cp -a /home/ubuntu/soulstream-uploadN/img \
  /var/www/thibautfontaine.space/streaming/ && \
  sudo chown -R www-data:www-data /var/www/thibautfontaine.space/streaming/img'
```

Source ZIP (exclude the APK and build outputs):

```bash
zip -rq SoulStream-source.zip . \
  -x 'node_modules/*' 'android/.gradle/*' 'android/build/*' \
     'android/app/build/*' 'android/app/.cxx/*' '.git/*' \
     'ios/Pods/*' 'ios/build/*' 'releases/*' '.bundle/*' \
     'android/local.properties' '*.hprof'
sha256sum SoulStream.apk SoulStream-source.zip > SHA256SUMS.txt
```

Verify publicly:

```bash
curl -sSL https://thibautfontaine.space/streaming/SoulStream.apk | sha256sum
curl -sSL https://thibautfontaine.space/streaming/SoulStream-source.zip | sha256sum
curl -sSI https://thibautfontaine.space/streaming/SoulStream.apk
```

Then:

- remove the VPS temp dir;
- append one line to `~/AGENT_CHANGELOG.md`;
- **no nginx config/reload** — `/var/www/thibautfontaine.space` is the static
  root and `/streaming/` is served by `location /`;
- do not touch other sites (`piano-midi`, `muay-thai`, `climate`,
  `easter-egg`, `eisenhower`, `instabot`, `llmcheck`, `nginx`);
- `llmcheck.service` and `jobkit-fetch.service` were already failed before this
  project; do not “fix” them here.

---

## 9. Sharing on Soulseek — current state

- Sharing is a **client feature**, not an account flag.
- Version 0.2.0 shares:
  - tracks already downloaded/played (LRU cache, 1 GiB default);
  - MP3s imported manually from the phone;
  - announces them with `SharedFoldersFiles`, serves `GetShareFiles` and
    uploads.
- Limits: one upload slot, Wi-Fi-only by default, no distributed search tree,
  no obfuscated peer connections.
- Users expect sharing; some clients detect leechers. Sharing is enabled by
  default so fresh installs are not leeches, but it can be disabled in
  **Réglages → Partage**.
- Official rules: https://www.slsknet.org/rules.html ,
  https://www.slsknet.org/news/faq-page ,
  https://www.slsknet.org/news/node/523 .

---

## 10. Network/request optimizations

- One `FileSearch` per submitted query; identical running query ignored.
- Search stops at the first good match + 4 s fallback window (10 s max).
- `GetPeerAddress` cached 10 min; retry once on failure; concurrent lookups
  deduplicated.
- `PlaceInQueueRequest`: 3 s, then max one/minute, max 10.
- No `WatchUser`, `GetUserStats`, chat, or distributed-tree participation.
- Late search responses dropped before zlib inflation.
- Search caps: 512 KiB compressed, 4 MiB inflated, 500 files, 200 hits.
- HTTP proxy yields to the event loop every 2 × 64 KiB.
- Source fallback avoids re-searching when a peer fails.

---

## 11. Known limitations / caveats

- No obfuscated peer connections; no distributed search tree.
- Sharing is limited to cached/imported MP3s; no folder picker for arbitrary
  folders (Android document picker imports copies).
- One stream and one upload at a time.
- Seeking only within buffered bytes.
- Streamed files capped at 64 MB (bigger ones left out); cache 1 GiB default.
- Short previews (<45 s) are penalized and may not auto-play.
- NAT/CGNAT: indirect `ConnectToPeer`/`PierceFirewall` is implemented; a
  reachable listening port still gives the best results.
- APK debug-signed; iOS not built here.
- If the OS backgrounds the app **before playback starts**, iOS/Android may
  suspend JS/sockets; once playback is active the native media service keeps it
  alive. Tab changes inside the app are not blocked.
- Soulseek login is plaintext at the protocol level; credentials are stored
  locally in Keychain/Keystore.
- `FileSearch` cannot be recalled from the network; the app only closes its own
  session and ignores late results.

---

## 12. User preferences (important)

- UI must stay **simple, Spotify/SoundCloud-like**: one clear action, mini
  player; no download buttons in the main flow.
- Search auto-plays the best match and stops as soon as possible.
- Search/download must be asynchronous; **never block the UI**; tab changes
  must work during loading.
- Levenshtein + local pre-search formatting; **no external DeepSeek/LLM API**
  has been added and none should be added without an explicit decision.
  The Deezer catalog API (metadata and covers, no key) was approved by the
  owner on 2026-10-24; it can be turned off in Réglages.
- Only MP3.
- Minimize Soulseek requests.
- The owner writes French; user-facing UI/docs are French, code comments English.
- GitHub repo is private; collaborator `CallaoVinicius` has write access.
- The VPS page is updated with each user-visible build; the owner downloads via
  `thibautfontaine.space/streaming`.
- Use the existing repo only; default private; never expose secrets; no nginx
  changes unless explicitly required.

---

## 13. Resume checklist after compaction

1. Read this file, `README.md`, and `git log --oneline -6`.
2. `git pull` and check `git status` is clean.
3. `npm test && npm run typecheck` before changing anything.
4. For UI work: start emulator + fake server (§7), `adb forward 22345`, use
   `DURATION=300` and query `Fake Song 1`.
5. For a public build: build the APK (§6), run `tools/showcase.mjs` with the VPS
   URL, commit, regenerate the source ZIP, deploy (§8), verify hashes and QR,
   append `~/AGENT_CHANGELOG.md`, remove VPS temp dirs.
6. Do not touch nginx/other sites, do not expose secrets, do not add paid or
   third-party services without approval.
7. If the task is about sharing, extend the existing `uploads.ts` +
   `trackCache.ts` path rather than rebuilding the client.
