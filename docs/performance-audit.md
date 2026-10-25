# Responsiveness audit (async, background, catalog)

Date: 2026-10-25. Scope: `TODO.md` item "Audit asynchronous behaviour and
responsiveness". Done in a cloud session: code review plus timings of the
JS-thread work in Node 22 (desktop CPU, JIT). Hermes on a phone is several
times slower (no JIT on most paths), so every number below should be read as
"multiply by 5–10 on a mid-range phone". A frame is 16 ms.

## Findings and fixes

| # | Problem | Before | After | Commit |
| --- | --- | --- | --- | --- |
| 1 | Grouping search results under catalog tracks (`unifyResults`) rescored every file against every track, every 400 ms while a search runs | 534 ms per regroup (400 files × 10 tracks) | longest regroup step 5.5 ms; whole search 152 ms spread over 40 steps | `9900f4d` |
| 2 | Ranking (`rankHits`) re-parsed every file name on each update | 21 ms | cached per hit/query; negligible on repeats | `9900f4d` |
| 3 | A finished download (5–10 MB) was base64-encoded in one go on the JS thread before writing | ~33 ms per 1.5 MB here → seconds on a phone, plus a ~13 MB string | written in 192 KB pieces (`appendFile`), the UI runs between pieces; `.part` file renamed when complete | `9900f4d` |
| 4 | Embedded covers were always base64-encoded to a data URI | 33–69 ms per 1.5 MB picture | skipped when the catalog has a cover, and above 1 MB | `9900f4d` |
| 5 | Home suggestions (up to 16 Deezer requests) could queue ahead of a search typed right after | up to ~2 s extra wait | two priorities: searches and opened pages first | `9900f4d` |
| 6 | A server socket that died while the phone slept (or on a Wi-Fi ↔ mobile switch) still looked "online"; the keep-alive ping gets no reply, so nothing noticed | searches silently returned nothing until a much later reconnection | `checkConnection`: asks the server for our own address, drops the socket after 8 s of silence → normal reconnection. Runs when the app returns after > 1 min in background and on network type change | `9fb609e` |
| 8 | First search froze a modest phone. Timed without JIT (closer to Hermes): scoring up to 50 ms per update, 1.4 s in one step when the catalog answered late; the screen built every result row (up to ~300) | freezes for seconds | scoring in ≤ 8 ms slices with UI turns in between; refresh from cached scores 2.4 ms; first 20 file rows, then "Afficher plus" | see git log `perf(search)` |
| 7 | Cached tracks built a new `SearchHit` object per search | caches never reused | one object per cache entry | `9900f4d` |

## Checked and fine

- Soulseek client: searches, peer connections, transfers and uploads are
  event-driven; several searches can run at once (background source
  searches do not cancel the user's).
- Late search replies are dropped before zlib inflation; reply caps
  (512 KiB compressed, 4 MiB inflated, 500 files, 200 hits) bound the parse
  (2.6 ms for a 500-file reply here).
- The local HTTP proxy yields every 2 × 64 KiB; transfer progress reaches the
  store at most every 250 ms.
- Catalog (Deezer): 8 s timeout, throttled (≈ 8 req/s, 4 in parallel),
  cached, in-flight requests shared; a slow or failing catalog never blocks
  the Soulseek search or playback (both run in parallel, results merge when
  they arrive).
- Reconnection: exponential backoff (2 s → 60 s), immediate retry when the
  network comes back (NetInfo) or the app returns to the foreground.
- Library save (`JSON.stringify` of 200 history entries): 0.3 ms.

## Still open

- **Measure on a real device** (needs a phone or emulator, not available in
  the cloud sandbox): frame drops during a search and at the end of a
  download (`adb shell dumpsys gfxinfo com.soulstream.app`), time to first
  sound, and the background case (screen off 5+ minutes without playback,
  then search; and Wi-Fi → mobile data while playing).
- **Audio bytes cross the JS bridge as base64** (react-native-tcp-socket):
  ~10 MB decoded in and ~10 MB encoded out per track, plus the cache write.
  Without JIT that is ~2.6 s per 10 MB here, mostly while a track starts.
  Fixes, from cheap to thorough: a native base64 (JSI) patched into the
  socket library; a native (Kotlin) data path peer → file → local server.
- **Memory peaks** at the end of a download (buffer + copy + base64
  strings, ~60–80 MB for 10 MB) and up to 256 MiB for one stream in memory:
  can get the app killed on low-RAM phones. Cap and avoid copies.
- **Diagnostics**: read Android's process exit reasons (API 30+) to tell a
  low-memory kill from a native crash or an ANR.
- Stale catalog requests (an old query) are not aborted, only ignored: no
  UI cost, a little network.
- Library storage is one JSON blob; fine today, revisit if libraries grow to
  thousands of entries (library import, parked).
