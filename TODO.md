# TODO

Shared to-do list for the owner and every agent (Claude, DeepSeek...).
Ordered by priority, highest first. When an item is done, remove it in the
commit that finishes it (git history keeps the record); add new items where
they belong in the order, with enough context to start without asking.

## 1. Audit asynchronous behaviour and responsiveness

- Check that nothing blocks the JS thread: Soulseek connection and
  reconnection, searches (including the parallel catalog-corrected search),
  peer connections, transfers, uploads, ID3 parsing, cache I/O.
- Check the Soulseek connection keeps working in the background (screen off,
  app in background) and recovers when the app returns.
- Check Deezer catalog fetches never delay the UI or playback: timeouts,
  throttling, cancellation of stale requests, cache hits, behaviour when
  offline or when Deezer is slow.
- Measure on a device (JS frame drops, time to first sound) and add
  regression tests where possible.

## 2. Check behaviour on older, low-RAM devices (last)

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
