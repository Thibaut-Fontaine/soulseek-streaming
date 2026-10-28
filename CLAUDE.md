@AGENTS.md

## Claude Code notes

- `AGENTS.md` (imported above) is the source of truth, shared with other
  agents such as DeepSeek. Put project rules there, not here; keep this file
  for Claude-specific notes only.
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
