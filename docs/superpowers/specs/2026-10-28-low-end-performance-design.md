# Low-end Android performance run — design

Date: 2026-10-28. Lead: Claude Code (laptop session), requested by Leo.

## Revision (2026-10-28, after Leo's feedback): simpler scope

Leo judged the measurement-first plan too heavy. This section **replaces**
"Goals", "The performance report" and "Comparability" below where they
conflict:

1. Fix the identified suspects directly, checking each on the emulator
   (render counts, JS timings, memory, APK size): redraws (progress hooks,
   store selectors, transfer progress), long non-virtualized lists, cover
   sizes, R8 / APK size.
2. Multi-threading, the practical part: inflate zlib search replies in a
   Kotlin module on a background thread instead of `pako` on the JS thread
   (`pako` stays as the test/Node fallback). Animations already use the
   native driver. JS worker-thread libraries are out (most need the New
   Architecture; old ones are unmaintained).
3. Minimal measurement: a JS-thread stall watcher writes stalls > 300 ms to
   the existing journal (`perf` tag, with the current tab). No persisted
   report, no checklist, no new share button.
4. One build for the Redmi owner; the native audio path and New
   Architecture remain later decisions.

## Why

The app is smooth on a flagship (Dimensity 9400+, 12 GB) but lags on the
co-founder's phone: a low-end Redmi, a few years old (micro-USB, ~4 GB RAM,
probably a Snapdragon 4xx/6xx or Helio class CPU, Android 10–12). Spotify
runs smoothly on the same phone. Matching Spotify is not the goal; any
measurable improvement on that phone is.

Earlier audits (`docs/performance-audit.md`) were code reviews timed on a
desktop CPU. They fixed what reading code reveals (search scoring, chunked
writes, native base64) but left "measure on a real device" open. Problems
that only appear on weak hardware — redraw storms, unvirtualized lists,
oversized images — were never measured. This run starts with measurement.

The two developers are not physically together: the Redmi cannot be plugged
into the laptop. The emulator on the laptop uses software rendering (~97 %
janky frames on everything), so its frame numbers are worthless; it is still
fine for relative JS timings, render counts, memory and startup.

## Goals

1. **Performance report** built into the app, so the Redmi's owner can use the
   app normally and send back numbers through the existing journal sharing.
2. **Baseline** from the Redmi with the current code (report only, no fixes).
3. **Fix the usual low-end suspects**, each fix measured where possible:
   - long pages that build every row (plain `ScrollView`s in Home, Library,
     Search, Sheets) → virtualized lists where the content can be long;
   - redraws: `useProgress(250)` in `PlayerScreen` and `useProgress(500)` in
     `MiniPlayer` re-render whole screens; 167 `useAppStore(` selectors, some
     may return fresh objects/arrays or subscribe to fast-changing state
     (transfer progress every 250 ms);
   - cover images: request a Deezer cover size matching the tile, not the
     largest; check decoded image memory;
   - startup and APK: R8 (`enableProguardInReleaseBuilds = false` today),
     APK of 61 MB carrying 4 ABIs; check heavy work at launch.
4. **Second report** from the Redmi on the fixed build, compared with the
   baseline, written into `docs/performance-audit.md`.
5. **Decide with numbers** whether the bigger moves are worth it: native
   (Kotlin) audio data path, New Architecture (needs a track-player upgrade
   or replacement). Not built in this run.

## Non-goals

- Parity with Spotify.
- Native audio path or New Architecture migration (decision only).
- Visual redesign; UI behaviour stays the same.
- iOS.

## Anti-goals (would be failures even if "faster")

- Any telemetry sent off the device (AGENTS.md: no analytics). The report
  leaves the phone only when its owner taps "Partager".
- A monitor that itself costs noticeable CPU/battery on the Redmi.
- Breaking the rules in `AGENTS.md` (MP3 only, minimal Soulseek requests,
  catalog-off mode working, no download buttons, home page content).
- Fixes that change behaviour silently (e.g. a virtualized list that loses
  scroll position or "Afficher plus" behaviour).

## The performance report

What it must answer: *when the app feels slow on that phone, which thread
was blocked, for how long, on which screen, doing what?*

Measurements:

- **JS thread stalls**: a light timer (e.g. every 100 ms) measuring its own
  delay; a delay above a threshold (≈ 100 ms) is a stall. Record duration,
  current screen/tab, and activity flags (search running, track loading,
  download in progress, playing). Count and histogram (100–250, 250–500,
  500 ms–1 s, > 1 s).
- **UI thread frames**: a small Kotlin module using `Choreographer` frame
  callbacks, counting frames slower than ~2 vsync intervals and long frames
  (> 100 ms), aggregated (not per-frame events across the bridge — batch
  and send a summary every few seconds or on demand).
- **Startup**: process start (`Process.getStartUptimeMillis()`) to first
  rendered screen, and to "logged in / home shown".
- **Memory**: app PSS / Java + native heap at intervals and at peaks; device
  total RAM and "low memory" flag (`ActivityManager.MemoryInfo`).
- **Device facts**: model, Android version, total RAM, CPU cores, refresh
  rate, app version.
- **Time to first sound** after tapping a track (tap → playback state
  playing), per play.

Storage and sharing: aggregates are kept in memory and persisted
periodically (AsyncStorage) so a whole day survives app restarts/kills;
the report is a readable text block prepended to the shared journal
(`DebugLogScreen` "Partager" already exists), with a reset action. Notable
stalls (> 500 ms) also go to the journal as `perf` lines with context.

Always on in test builds and cheap enough to stay on (the monitor's own cost
is measured on the emulator and stated in the audit doc).

## Constraints

- AGENTS.md rules and conventions (French UI text, English code/docs,
  Conventional Commits, typecheck + lint + tests before commits, version
  bumps for every published APK, one logical change per commit).
- Old architecture stays (`newArchEnabled=false`); track-player patch kept.
- APKs are published on the branch (`releases/`, `showcase/`); deployment to
  the VPS is the owner's. Leo forwards builds and reports between us and
  the Redmi's owner.
- Laptop build needs JDK 21 (see local memory notes); emulator is headless.

## Decided

- Measure first, ship the report-only build as its own version before any
  optimisation, so the baseline is clean.
- The report uses the existing journal sharing; no new external service.
- Order of fixes after baseline: guided by the report; if it is inconclusive,
  default order is redraws → lists → images → startup/APK.
- Big architectural changes are decided after the second report, not built
  in this run.

## Comparability (lead's calls after review)

- **Scripted session + free use.** Each build comes with a ~5-minute
  checklist for the Redmi owner (cold start, one search, play a track, open
  an artist page, scroll Home and Library, open the full player), run once,
  then normal use. The report buckets everything per screen and activity,
  so free use is still comparable by bucket; the scripted run gives a clean
  like-for-like line. A "Début du test" button marks the scripted run.
- **Same conditions.** Install over the previous build (keeps app data and
  caches), same settings. The report header records settings (catalog,
  sharing, buffer), network type and app version, so differences are visible.
- **Monitor ships in every APK**, not a test-only flavour: it is cheap, there
  is a single build type, and both reports must use identical code. Its only
  UI is inside Réglages → Journal de débogage.
- **Compact report, own share button.** Chat apps may cut long text: the
  summary stays under ~60 lines, comes first in the shared journal, and a
  separate "Partager le rapport" shares the summary alone.

## Left to the builder

- Exact thresholds, sampling intervals and report layout (keep it readable
  in a chat message).
- Which lists actually need virtualization (only those that can be long).
- How to detect "current screen" (tab state, open page/sheet in the store).
- Whether to ship one ABI-split APK or keep a universal APK plus R8 only
  (the friend installs from a link; a wrong-ABI APK must not be possible).
- Tests for the pure parts (stall bucketing, report formatting, persistence).
