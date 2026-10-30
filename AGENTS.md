# AGENTS.md — SoulStream

Instructions for any coding agent working on this repository (Claude Code,
DeepSeek through OpenCode, Codex, Cursor...). This file is the single source
of truth for agents: `CLAUDE.md` only imports it. Keep it tool-neutral, short
and current; update it in the same commit as any change it describes.

## Project

SoulStream is a React Native 0.81 app (Android first, iOS untested) that
streams MP3s from the Soulseek P2P network. It logs in to the official
Soulseek server, searches, downloads from a peer and plays while the bytes
arrive through a local HTTP Range proxy feeding `react-native-track-player`.
An online catalog (Deezer public API) gives canonical tracks, artists, albums,
covers and similar artists; Soulseek files are matched to catalog tracks and
used as their sources.

- UI text and user-facing docs (`README.md`, showcase page): **French**.
- Code, comments, commit messages and agent docs: **English**.
- Owner: Thibaut Fontaine. GitHub repo is public
  (`Thibaut-Fontaine/soulseek-streaming`).

## Commands

```bash
npm install            # also applies patches/ (patch-package)
npm test               # jest, all suites (~1 min)
npx jest __tests__/catalog.test.ts   # one suite
npm run typecheck      # tsc --noEmit, must be clean
npm run lint           # eslint: 0 errors required (existing warnings are accepted)

# Android release APK (debug-signed with the repo key, installs over older builds)
cd android && ./gradlew assembleRelease --no-daemon
# -> android/app/build/outputs/apk/release/app-release.apk

# Publish a build on the current branch (APK copy, showcase page, QR code).
# Commit app changes first: the script refuses a dirty app tree.
node tools/showcase.mjs android/app/build/outputs/apk/release/app-release.apk
```

Before every commit: `npm run typecheck`, `npm run lint` (0 errors) and the
tests touching what you changed; before a push, the full `npm test`.

## Architecture

```
src/core/            pure TypeScript, no React Native imports, unit-tested in Node
  protocol.ts        Soulseek message codes, encoders, parsers (zlib search replies)
  soulseekClient.ts  server + peer connections, searches (several at once), transfers, shares
  transfer.ts, chunkBuffer.ts, framer.ts, bytes.ts, uploads.ts, id3.ts
  search.ts          query cleaning, Levenshtein scoring, ranking of Soulseek hits
  catalog.ts         CatalogProvider interface + Deezer provider (throttled, cached)
  catalogTypes.ts    catalog entities and store contract (tracks, artists, albums, pages)
  musicMap.ts        bounded related-artist graph for the Music Map page
  autoplay.ts        catalog recommendations when a list ends (no repeats)
  transcode.ts       pure smallest-source / 94 kbps policy (native encoder blocked)
  autoBrowse.ts      Android Auto browse tree over library/device/cache
  logPrivacy.ts      validation + redaction shared by the app and log server
  unify.ts           match Soulseek files to catalog tracks (title, artist, duration)
  share.ts           shared track links (soulstream://, Deezer URLs); MainActivity
                     turns text shared to the app into a link
  types.ts           SearchHit, MP3-only policy, path parsing
src/services/        streaming orchestration, settings + Keychain, track cache, library, debug log
src/stream/          local HTTP Range proxy for the native player
src/state/store.ts   zustand store: search, catalog, pages, playback, fallback, library
src/ui/              screens, pages (artist/album), sheets, components, theme
src/player/          track-player setup and background service
src/transport/       TCP transport: react-native-tcp-socket (app), node:net (tests)
server/logs/         VPS-ready log ingest API (HTTP adapter, retention, file store)
__tests__/           jest suites; fixtures/deezer/ holds recorded Deezer answers
test-utils/          fake Soulseek server + peers (multiPeerNetwork), UI fixtures
tools/               fake-network.ts (dev server), showcase.mjs, icon/ (app icon source
                     + generator), gradle/ (cloud mirror)
docs/                design notes (catalog research, catalog UI spec)
showcase/, releases/ public landing page, QR code, published APK
```

Data flow of a search: with the catalog on, a typed search only asks the
catalog (no Soulseek request). Soulseek is searched for a title when it is
played (`playCatalogTrack` → `resolveTrack`) with a query ladder
(`soulseekLadder` in `unify.ts`: artist + title, then title only, then
artist + album, each tried only if the previous found no source, 9 s in all),
which then plays the best source with automatic fallback to the next ones. A Soulseek file search for the query
runs only when the catalog is off, finds nothing or is unreachable, or when
the user taps "Chercher les fichiers sur Soulseek" (`searchFilesToo`); then
the catalog's spelling is searched too (fixes typos) and `unify.ts` groups the
files under catalog tracks (`state.groups`). Queries go out in lowercase, plus
an accent-free copy when they have accents.

## Rules that must not regress

- **MP3 only** (`STREAMABLE_EXTENSIONS` in `src/core/types.ts`), enforced in
  search parsing and transfers.
- **Never block the JS thread / UI**: late search replies are dropped before
  zlib inflation; search caps (512 KiB compressed, 4 MiB inflated, 500 files,
  200 hits); the HTTP proxy yields every 2 × 64 KiB; ConnectToPeer requests
  past the cap are dropped silently (no log, no reply). Tabs must stay usable
  while a track loads. Target a low-end phone (~4 GB RAM): playback position
  and transfer progress are read only by small leaf components
  (`useCurrentTransfer`, `useReceivedRatio` in `src/ui/hooks.ts`), visited
  tabs stay mounted (`src/ui/TabHost.tsx`), long lists use `FlatList`,
  release builds use R8. JS stalls ≥ 300 ms are journaled (`perf` tag).
- **Minimise Soulseek requests**: no Soulseek search while browsing the
  catalog; one search per played title (plus the accent-free spelling),
  the next ladder step only when it found no source;
  peer address cache, queue polling at most once a minute, no
  distributed search tree, no chat or user watching.
- Nothing plays until the user taps a result. Short files (< 45 s) are
  previews and are penalised.
- **Catalog**: Deezer's public API, no key. Its terms are non-commercial only;
  keep all provider code behind `CatalogProvider` so it can be replaced
  (MusicBrainz + Cover Art Archive is the planned fallback). Respect its rate
  limit (the provider throttles and caches; do not bypass it). The app must
  work fully with **Réglages → Catalogue en ligne** off (`catalogEnabled`).
- **Home page**: only content derived from the user's listening history
  (recent artists, albums of recent tracks, similar artists). No charts,
  trends or genres — this was an explicit product decision.
- No other external service (analytics, LLM APIs, paid APIs) without an
  explicit decision from the owner.
- UI stays simple, Spotify-like: one clear action per surface, mini player,
  no download buttons in the main flow.
- Sharing is on by default (Wi-Fi only, one upload slot): extend
  `uploads.ts` + `trackCache.ts`, do not rebuild it.
- Native: `newArchEnabled=false` (track-player 4.1.2 is not TurboModule
  ready); keep `patches/react-native-track-player+4.1.2.patch`.

## Conventions

- **Brand colour is amber** (`#FFB627`, `colors.accent` in `src/ui/theme.ts`,
  `app_accent` in `android/app/src/main/res/values/colors.xml`, the icon in
  `tools/icon/icon.mjs`); warnings use orange, not amber. The app icon is
  generated: edit `tools/icon/icon.mjs`, run `node tools/icon/generate.mjs`,
  never hand-edit the generated drawables/PNGs.

- TypeScript strict; small pure functions in `src/core`, side effects in
  services and the store. Prefer extending existing modules over new layers.
- Comments explain *why*, briefly, in plain English.
- Tests: core logic gets unit tests; network behaviour uses `test-utils/
  multiPeerNetwork.ts`; screens are rendered with `react-test-renderer` and
  store state. Network tests must not call the real Deezer API: inject a
  `CatalogProvider` (`setCatalogProvider`) or set `catalogEnabled: false`.
- Commits: Conventional Commits (`feat(scope):`, `fix:`, `build:`, `docs:`,
  `chore:`, `test:`), imperative, body says why. One logical change per commit.
- Versions: bump `versionCode` and `versionName` in `android/app/build.gradle`
  and `version` in `package.json` together for every published APK.
- Do not commit `node_modules`, build outputs, `android/local.properties`,
  `ios/Pods`, secrets or keystores other than the existing debug one.

## Environments

- **Owner's workstation + VPS** (DeepSeek/OpenCode sessions): emulator, fake
  network and VPS deployment steps are in `after-compact.md`. Never change
  nginx or other sites on the VPS.
- **Claude Code cloud sessions**: `.claude/hooks/session-start.sh` installs
  npm dependencies, the Android SDK in `/opt/android-sdk` and a Gradle init
  script (`tools/gradle/google-central.gradle`). Maven Central rate-limits that
  sandbox (random 429/404 in Gradle); the init script sends those downloads to
  Google's mirror. The VPS is not reachable from there: publish APKs on the
  branch (`releases/`, `showcase/`) and let the owner deploy.

## Documentation map

| File | Purpose |
| --- | --- |
| `AGENTS.md` | This file: rules and map for every agent |
| `TODO.md` | Prioritised to-do list (highest first), shared with the owner |
| `CLAUDE.md` | Imports `AGENTS.md`; Claude-only notes |
| `after-compact.md` | Operator handoff: workstation, emulator, VPS deploy, history |
| `README.md` | French user/developer documentation |
| `docs/unified-catalog-research.md` | Why and how the catalog works (sources, matching) |
| `docs/catalog-ui-design.md` | Catalog screens, components and states |
| `docs/performance-audit.md` | Responsiveness audit: measurements, fixes, open checks |
| `docs/peer-search-research.md` | How peers match queries; query problems and the query ladder |
| `docs/library-import-research.md` | Importing a library from other music apps (parked) |
| `docs/bitrate-transcode.md` | Smallest-source policy, 94 kbps encoder options and blocker |
| `docs/android-auto.md` | Android Auto service, bridge, tests and DHU plan |
| `server/logs/README.md` | Log ingest API, privacy contract and VPS steps |
