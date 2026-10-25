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
- Personal overrides go in `CLAUDE.local.md` or `.claude/settings.local.json`
  (both git-ignored).
