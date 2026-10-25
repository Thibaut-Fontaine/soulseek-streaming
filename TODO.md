# TODO

Shared to-do list for the owner and every agent (Claude, DeepSeek...).
Ordered by priority, highest first. When an item is done, remove it in the
commit that finishes it (git history keeps the record); add new items where
they belong in the order, with enough context to start without asking.

## 1. Import a music library from a streaming app, selectively

Let the user bring their existing library (liked tracks, playlists, albums,
followed artists) from a music streaming service into SoulStream, choosing
what to import rather than everything.

- Research which services allow it and how: official APIs (Spotify, Deezer,
  Apple Music, YouTube Music...), their auth requirements for a mobile app
  without a server secret (PKCE), rate limits and terms; and export files
  (CSV/JSON from the service or from tools such as Exportify, TuneMyMusic).
- Selective import UI: pick playlists / albums / liked tracks, preview, then
  import into the library (likes, playlists).
- Match imported tracks to catalog tracks (`src/core/catalog.ts`, by ISRC
  when available, else artist + title + duration); Soulseek sources are found
  later, on play (`resolveTrack`), never in bulk (keep Soulseek requests low).
- Needs a decision from the owner: a new external service and account link
  (see `AGENTS.md`, "No other external service ... without an explicit
  decision").

## 2. Audit asynchronous behaviour and responsiveness

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

## 3. Check behaviour on older, low-RAM devices (last)

- Test on an older / low-RAM Android device or emulator profile (2–3 GB RAM,
  older Android version; minSdk is 24).
- Watch memory: the in-memory stream buffer (256 MiB cap), cover images
  (catalog artwork sizes), kept-mounted pages, list virtualisation.
- Lower limits or sizes when the device reports little memory.
