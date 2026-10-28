# TODO

Shared to-do list for the owner and every agent (Claude, DeepSeek...).
Ordered by priority, highest first. When an item is done, remove it in the
commit that finishes it (git history keeps the record); add new items where
they belong in the order, with enough context to start without asking.

## 1. Open findings from the October 2026 audit (emulator + real network)

Seen on the emulator (fake network and real Soulseek, test account
`soulstream_dev`), not fixed yet:

- A track from a search-result list with no source skips to the next
  result ("Get Lucky" → "Veridis Quo"): `playCatalog` applies the album
  behaviour to every list. Skip only in albums, radios and top tracks.
- A transfer waiting for the peer's TransferRequest fails 5 s after its P
  connection closes (`handlePeerSessionClosed`), although uploaders keep
  queued requests: keep waiting (or reconnect and re-send QueueUpload).
- Two devices on one account kick each other: after RELOGGED, coming back
  to the foreground reconnects and logs the other device out.
- "Réessayer" / `reconnect()` goes through `login()`, which stops a track
  playing from the device cache (no network needed).
- Owner report, parked until a screen recording: the full player could
  not be closed (it still scrolled) around "Autre source"; not reproduced.

## 2. Audit asynchronous behaviour and responsiveness: device checks

Code audit and fixes done (`docs/performance-audit.md`): search scoring
(534 ms → 5.5 ms per update), chunked download writes, cover decoding,
catalog request priority, dead-connection detection after sleep. Left:

- Measure on a real phone/emulator: frame drops during a search and when a
  download finishes (`adb shell dumpsys gfxinfo com.soulstream.app`), time
  to first sound.
- Background: screen off 5+ minutes without playback, then search; Wi-Fi →
  mobile data while playing. Check the app reconnects on its own.
- Done since: search scoring in 8 ms slices, catalog-only search (Soulseek
  searched on play), native base64 for audio bytes, 64 MB stream cap and
  copy-free cache writes, exit-reason diagnostics. After a crash or freeze,
  read Réglages → Journal de débogage. If tracks still stutter when they
  start on modest phones: native (Kotlin) data path (see the audit).

## 3. Optional pre-download of the next track (setting, off by default)

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

## 4. One Soulseek search per album

When an album starts playing, search "artist album" once and match the
files to every track of the album (`sourcesForTrack` per track). The query
ladder already ends with an "artist album" step (`soulseekLadder`), but per
track and only when the other steps failed. Albums are
shared as folders, so one request usually covers them, from the same peer and
quality. Only tracks still without a source get their own search on play.

## 5. Check behaviour on older, low-RAM devices (last)

- Test on an older / low-RAM Android device or emulator profile (2–3 GB RAM,
  older Android version; minSdk is 24).
- Watch memory: the in-memory stream buffer (64 MB cap), cover images
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
