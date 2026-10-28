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
| 9 | Audio bytes crossed the bridge as base64 through the JS Buffer polyfill (socket in, proxy out, cache write) | ~2.6 s JS time per 10 MB without JIT | native JSI codec (react-native-quick-base64 2.2.2) patched into react-native-tcp-socket, used for track writes and covers; Buffer as fallback | `perf(bridge)` |
| 10 | Memory peak at the end of a download (buffer + full copy + base64), one stream up to 256 MiB | can get the app killed on low-RAM phones | streamed files capped at 64 MB (bigger ones left out of results); downloads saved from the buffer 192 KB at a time | `perf(memory)` |
| 11 | Silent closes (memory kill, native crash) left no trace | — | Android exit reasons (API 30+) and Java crash stack traces written to the journal at next launch | `feat(diagnostics)` |
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

## Low-end phone run (2026-10-28, 1.3-beta15)

Target: the co-founder's low-end Redmi (~4 GB RAM), which lags where a
flagship does not. Measured on the laptop emulator (Android 14, software
rendering: frame numbers are meaningless there, JS stalls and start times
are still comparable) and on the real network with the test account and
free-to-share music only. Plan: `docs/superpowers/plans/2026-10-28-low-end-performance.md`.

| # | Problem | Before | After | Commit |
| --- | --- | --- | --- | --- |
| 12 | Playing a popular title brought a storm of ConnectToPeer requests (peers holding the file, unable to reach us behind NAT); past the 12-connection cap each still wrote a journal line and sent CantConnectToPeer (a bridge write). Mostly from the next-track source lookup falling back to a title-only query ("crusade") | ~9,500 requests in 2 min; JS thread frozen 3–7 s at a time (emulator) | declined requests cost a parse and a counter; 500-request test: 0 server writes (was 488), ≤ 13 journal lines | `perf(network)` |
| 13 | Mini player and full player re-rendered whole 2–4×/s for the playback position, and twice per download update (snapshot + speed hook) | 6 renders of the player body for 5 position ticks; 13 for 5 download steps | scrubber, progress bar, transfer card and source chip subscribe on their own: 0 body renders | `perf(player)` |
| 14 | Every tab switch unmounted the screen and rebuilt the next one (covers, shelves, gradients) | full rebuild per switch | Accueil / Rechercher / Bibliothèque stay mounted once visited (`TabHost`); re-tapping the tab rebuilds it at its root | `perf(ui)` |
| 15 | Bibliothèque built every row of liked titles / history (200) / device tracks in a ScrollView | 150 rows built for a 150-track list | FlatList, ~12 rows first; stable row callbacks | `perf(library)` |
| 16 | Full player blurred the 1000 px cover (software blur on Android) | 1000 px decoded and blurred per track | 250 px cover, same look | `perf(player)` |
| 17 | Release build had no R8: 26 MB of bytecode in 3 dex files, loaded at each cold start | APK 61.5 MB; cold start median ~3.3 s (emulator) | one 6.4 MB dex, APK 54.1 MB; cold start median ~2.0 s | `build(android)` |
| 18 | JS stalls only logged above 1 s, without context, and the background pause could be logged on resume | — | `stallWatcher`: stalls ≥ 300 ms go to the journal as `perf` lines with tab, player and search state | `feat(diagnostics)` |

Checked and dropped: inflating search replies in Kotlin. `pako` takes
≈ 5.7 ms for a 500-file reply with `node --jitless` (close to Hermes),
< 1 ms for a typical one; a bridge round trip would cost about as much.
Animations already use the native driver.

Still seen on the emulator after the fixes: repeated 300–900 ms stalls on
Accueil during start-up (library load, home shelves, catalog answers);
worth a look once the Redmi journal confirms them.

## Still open

- **Report from the low-end Redmi** on 1.3-beta15: share Réglages →
  Journal de débogage after normal use; `perf` lines say how long the JS
  thread was blocked and where. Also the background case (screen off 5+
  minutes without playback, then search; Wi-Fi → mobile data while playing).
- **Next-track source lookup**: its title-only fallback query is the main
  source of ConnectToPeer storms (#12); consider skipping the title-only
  step for look-ahead searches, or moving the look-ahead behind the
  pre-download setting (TODO §3).
- **Audio still flows through JS** (now with native base64): the thorough
  fix is a native (Kotlin) data path peer → file → local server, if device
  tests still show stutters when a track starts.
- Stale catalog requests (an old query) are not aborted, only ignored: no
  UI cost, a little network.
- Library storage is one JSON blob; fine today, revisit if libraries grow to
  thousands of entries (library import, parked).
