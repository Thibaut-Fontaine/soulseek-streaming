# TODO

Shared to-do list for the owner and every agent (Claude, DeepSeek...).
Ordered by priority, highest first. When an item is done, remove it in the
commit that finishes it (git history keeps the record); add new items where
they belong in the order, with enough context to start without asking.

## 1. Audit asynchronous behaviour and responsiveness: device checks

Code audit and fixes done (`docs/performance-audit.md`): search scoring
(534 ms → 5.5 ms per update), chunked download writes, cover decoding,
catalog request priority, dead-connection detection after sleep. Left:

- Measure on a real phone/emulator: frame drops during a search and when a
  download finishes (`adb shell dumpsys gfxinfo com.soulstream.app`), time
  to first sound.
- Background: screen off 5+ minutes without playback, then search; Wi-Fi →
  mobile data while playing. Check the app reconnects on its own.
- Done since: search scoring runs in 8 ms slices (first-search freeze on a
  modest phone). Still open, see the audit: audio bytes as base64 through
  JS (~2.6 s CPU per 10 MB track without JIT), memory peaks at the end of a
  download, and reading Android's exit reasons to diagnose silent closes.

## 2. Optional pre-download of the next track (setting, off by default)

Not implemented. Today, when an album/radio/top-tracks list plays, only the
next track's *sources* are looked up in advance (one Soulseek search,
`playCatalog` in `src/state/store.ts`); nothing is downloaded ahead.

- Add a setting in Réglages (e.g. "Précharger le titre suivant", off by
  default; maybe "Wi-Fi uniquement" like sharing) — not automatic.
- When on: once the current track is fully downloaded, download the next one
  in the list (queue first, then the play context) into the track cache
  (`trackCache.ts`), so it starts instantly and gaplessly.
- Respect the existing limits: one transfer at a time per peer, cache size,
  Wi-Fi-only option, cancel the pre-download when the user skips elsewhere.
- Decide whether the automatic source lookup for the next track should also
  move behind this setting.

## 3. Check behaviour on older, low-RAM devices (last)

- Test on an older / low-RAM Android device or emulator profile (2–3 GB RAM,
  older Android version; minSdk is 24).
- Watch memory: the in-memory stream buffer (256 MiB cap), cover images
  (catalog artwork sizes), kept-mounted pages, list virtualisation.
- Lower limits or sizes when the device reports little memory.

## Parked (not scheduled)

### Import a music library from a streaming app, selectively

Research done: `docs/library-import-research.md`. Conclusion: account linking
is closed or impractical (Spotify dev mode = 5 users, Deezer app registration
closed, Apple needs a server, no YouTube Music API), so import **files**:
Spotify "Download your data", Exportify / TuneMyMusic / Soundiiz CSV, Google
Takeout (YouTube Music), Apple Music text/M3U exports. Match to the Deezer
catalog by ISRC (`track/isrc:…`, verified) or by search + existing matcher.

Parked by the owner on 2026-10-25 ("later"). When resumed, needs:
- confirm file import only (TIDAL account linking maybe later);
- real sample exports (their own Spotify data zip, ideally a Takeout and a
  TuneMyMusic CSV) to build the parsers; personal data stays out of the repo.

Then, in order: importers in `src/core/importers/` with tests; library model
change (saved tracks without a Soulseek hit, playlists, scalable storage);
background matching with progress; selective import screen.
