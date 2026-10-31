@AGENTS.md

## Claude Code notes

- `AGENTS.md` (imported above) is the source of truth, shared with other
  agents such as DeepSeek. Put project rules there, not here; keep this file
  for Claude-specific notes only.
- VPS APIs and the app update manifest: read `docs/vps-apis.md`. The log
  ingest endpoint is `https://thibautfontaine.space/logs/v1/logs`; the version
  manifest is `https://thibautfontaine.space/api/app/version`. Server code is
  on `main`; the app-side log uploader/updater remains to be implemented and
  verified from the requirements.
- **Feature backlog (14).** The authoritative requirements are in
  `AGENTS.md` → “Requested feature backlog (14)”, with the checklist in
  `TODO.md`. Treat every item as open; do not mark it done without tests and
  the relevant acceptance check.
  1. 500 KiB playback buffer.
  2. Prefer the lightest source (24/96/128 kbps before 320).
  3. Automatic Soulseek reconnection, including initial failure/foreground.
  4. Automatic peer fallback after 5 s without bytes, with a fresh search.
  5. Music Map + opt-in autoplay.
  6. Uploader names hidden by default; remove visible Soulseek branding.
  7. Opt-in VPS logs API (server deployed; app client open).
  8. Android Auto browsing/controls (device/DHU acceptance pending).
  9. Offline navigation and playback of downloaded/imported tracks.
  10. Smallest-source download; native 94 kbps transcode decision.
  11. Exact playback/queue/position persistence across crash or close.
  12. Version manifest update proposal (server deployed; app client open).
  13. Library-only “Changer” action for a mismatched/censored track.
  14. Screen-off playback acceptance and fixes.
- Cloud sessions run `.claude/hooks/session-start.sh` (registered in
  `.claude/settings.json`) before starting: dependencies, Android SDK and the
  Maven mirror are ready, so `cd android && ./gradlew assembleRelease` works
  directly. If Gradle still reports "Could not find …" for a Maven Central
  artifact, check that `~/.gradle/init.d/google-central.gradle` exists.
- Cloud sessions started from the Claude mobile app: after every APK build,
  send the APK to the user with `SendUserFile` (`releases/SoulStream.apk`,
  `display: "attach"`), so they can install it from the phone. Do not ask
  them to deploy it to the VPS: the VPS owner deploys it there through his
  own DeepSeek sessions.
- Personal overrides go in `CLAUDE.local.md` or `.claude/settings.local.json`
  (both git-ignored).
