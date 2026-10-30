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
- During a ConnectToPeer storm (popular title, audit #12) the 12-connection
  cap can decline the P connection of an uploader we queued (it wants to
  send TransferRequest): exempt users with a pending or queued transfer
  from the cap in `acceptIndirectConnection`.
- Two devices on one account kick each other: after RELOGGED, coming back
  to the foreground reconnects and logs the other device out.
- Owner report, parked until a screen recording: the full player could
  not be closed (it still scrolled) around "Autre source"; not reproduced.

## 2. Playback start and next track (requested by Leo, 2026-10-30)

- **Smaller buffer before playing**: start after 0.5–1 MB depending on the
  peer's rate (fast peer → 0.5 MB, slow peer → 1 MB). Today
  `bufferTargetFor` in `src/state/store.ts` waits for 15 % of the file,
  between 256 KiB and `settings.bufferMb` (default 2 MB). Measure the rate
  over the first bytes received, pick the target from it, and keep enough
  margin that playback doesn't stall right after it starts.
- **Pre-cache the next song in the queue**: once the current track is fully
  downloaded, download the next one in the queue into the track cache.
  Section 4 has the detailed plan (limits, cancel on skip). Decision for the
  co-owners: on by default, or a setting as section 4 proposes.

## 3. Audit asynchronous behaviour and responsiveness: device checks

Code audit and fixes done (`docs/performance-audit.md`): search scoring
(534 ms → 5.5 ms per update), chunked download writes, cover decoding,
catalog request priority, dead-connection detection after sleep. Left:

- Get the low-end Redmi's journal on 1.3-beta15 (Réglages → Journal de
  débogage → Partager, after a day of normal use): `perf` lines show each
  JS-thread stall ≥ 300 ms with the tab and what was loading. Fix what it
  points at; still-open emulator hint: stalls on Accueil at start-up.
- Background: screen off 5+ minutes without playback, then search; Wi-Fi →
  mobile data while playing. Check the app reconnects on its own.
- Done since: search scoring in 8 ms slices, catalog-only search (Soulseek
  searched on play), native base64 for audio bytes, 64 MB stream cap and
  copy-free cache writes, exit-reason diagnostics; 1.3-beta15 low-end run
  (audit rows 12–18: ConnectToPeer storm, player redraws, kept tabs,
  virtualized library, small backdrop blur, R8). If tracks still stutter
  when they start on modest phones: native (Kotlin) data path (see the audit).

## 4. Optional pre-download of the next track (setting, off by default)

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
  move behind this setting. Its title-only fallback query (e.g. "crusade")
  caused ~9,500 peer connection requests in two minutes on the real
  network (audit #12); at least skip that step for look-ahead searches.

## 5. One Soulseek search per album

When an album starts playing, search "artist album" once and match the
files to every track of the album (`sourcesForTrack` per track). The query
ladder already ends with an "artist album" step (`soulseekLadder`), but per
track and only when the other steps failed. Albums are
shared as folders, so one request usually covers them, from the same peer and
quality. Only tracks still without a source get their own search on play.

## 6. Check behaviour on older, low-RAM devices (last)

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
