# TODO

Shared to-do list for the owner and every agent (Claude, DeepSeek...).
Ordered by priority, highest first. When an item is done, remove it in the
commit that finishes it (git history keeps the record); add new items where
they belong in the order, with enough context to start without asking.

## Owner-requested feature backlog (14) — open, redo/verify

These are the owner's current priorities. The previous `dev` branch is **not
accepted** as done: reimplement and verify from the requirements below and in
`AGENTS.md` → “Requested feature backlog (14)”. The audit items below remain
open unless independently fixed. Do not mark a feature done from a branch or
an APK alone; tests plus the relevant device check are required.

- [ ] 1. Default playback buffer **500 KiB** (`bufferMb: 0.5`, "500 Ko"), with migration and the 15 %/256 KiB floor.
- [ ] 2. Prefer the **lightest usable source** (24/96/128 kbps before 320); keep a lone 320 playable.
- [ ] 3. **Automatic Soulseek reconnect** after any disconnect, including failed first connection and foreground; bounded backoff; no auth loop.
- [ ] 4. **Automatic peer fallback after 5 s** without bytes, refusal, queue or quota; try another peer and run a fresh search if needed; no manual "Relancer".
- [ ] 5. **Music Map** of related artists + opt-in **autoplay** recommendations, no repeats, clean stop.
- [ ] 6. **Hide uploader names** by default with a reveal setting; remove visible Soulseek branding from the UI.
- [ ] 7. **Opt-in VPS logs API**: server ingest deployed at `/logs/v1/logs`; app uploader/redaction/reimplementation remains open.
- [ ] 8. **Android Auto**: library browsing + controls; JVM/build checks and a DHU/device acceptance test.
- [ ] 9. **Offline mode**: navigation, downloaded/imported playback with no network/client; clear error for uncached tracks.
- [ ] 10. **Smallest-source storage + 94 kbps transcode**: native encoder decision (LAME/NDK preferred; no fake transcode test); fall back to original on failure.
- [ ] 11. **Playback persistence**: restore current track, queue/context, shuffle/repeat and exact position after crash/manual close; clear on logout; missing-source fallback.
- [ ] 12. **Update proposal**: startup check of `/api/app/version`, strictly newer `versionCode`, download + SHA-256 verification + Android installer; server manifest deployed, app client open.
- [ ] 13. **Library-only “Changer” action**: when the played file does not match the displayed/saved song (e.g. censored version), search and choose another source/version, update the saved entry and playback identity/history without touching the main search flow. Add component/store tests and a manual library test.
- [ ] 14. **Screen-off playback**: verify and fix playback with the screen off/locked, including foreground service, notification controls, Doze and the local HTTP proxy; add a device acceptance test and no background regression.

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

## 2. Audit asynchronous behaviour and responsiveness: device checks

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

## 3. Lighter look-ahead source search

While a list plays, the next track's sources are looked up in advance
(`playCatalog`), then that track is pre-downloaded once the current one is
complete (`prefetchNext`). The look-ahead runs the whole query ladder; its
title-only step (e.g. "crusade") caused ~9,500 peer connection requests in
two minutes on the real network (audit #12): skip that step for look-ahead
searches (it still runs when the track is played).

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
