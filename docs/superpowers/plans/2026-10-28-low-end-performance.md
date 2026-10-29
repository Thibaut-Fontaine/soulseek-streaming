# Low-end Android performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make SoulStream noticeably smoother on a low-end Redmi (≈ 4 GB RAM) by removing redraw and rebuild work from the JS thread, and log JS-thread stalls in the journal.

**Architecture:** Targeted UI fixes (fast-changing values isolated in small leaf components, tabs kept mounted, virtualized long lists, cheaper blur), a stall watcher service writing to the existing debug journal, R8 for the release build. No new architecture.

**Tech Stack:** React Native 0.81 (old architecture, Hermes), zustand, react-native-track-player 4.1.2, jest + react-test-renderer.

**Spec:** `docs/superpowers/specs/2026-10-28-low-end-performance-design.md` (read the "Revision" section first: it overrides the original goals).

## Global Constraints

- All `AGENTS.md` rules: MP3 only, minimal Soulseek requests, catalog-off mode works, Spotify-like UI, no external services.
- UI text French; code, comments, commits English; Conventional Commits; one logical change per commit.
- Before each commit: `npm run typecheck`, `npm run lint` (0 errors), the touched suites; full `npm test` before push.
- Visible behaviour unchanged except where a task says otherwise.
- Bump `versionCode`/`versionName` (`android/app/build.gradle`) and `package.json` `version` together for the published APK: 1.3-beta15, versionCode 18.
- Dropped after measurement (do not build): native zlib inflate. `pako` costs ≈ 5.7 ms for a 500-file reply with `node --jitless`, < 1 ms typical; a bridge round trip would eat the gain.

## Review Focus

1. Gestures on the mini player and full player (swipe skip/back, pull down) still read the *current* position after progress leaves the parent — a stale position would make "previous" restart vs. go back wrongly.
2. Re-tapping the current tab still returns to its root (top, filters reset) now that tabs stay mounted; switching tabs keeps each tab's scroll and state.
3. Hidden tabs must not steal touches, accessibility focus or the Android back button.
4. Library filtered lists (liked, history up to 200, device) keep row order, "play from here" context and the header/chips scrolling with the list.
5. R8 build: login, search, play, sharing, notification controls and the exit-reason module all still work (reflection-based native modules are the usual R8 breakage).

---

### Task 1: JS-thread stall watcher

**Files:**
- Create: `src/services/stallWatcher.ts`
- Modify: `src/services/debugLog.ts` (add `'perf'` to `LogTag`), `App.tsx` (start once after `ready`)
- Test: `__tests__/stallWatcher.test.ts`

**Interfaces:**
- Produces: `startStallWatcher(options?: { intervalMs?: number; thresholdMs?: number; now?: () => number; context?: () => string }): () => void` (returns stop). Defaults: interval 100 ms, threshold 300 ms. A tick whose delay beyond `intervalMs` is ≥ threshold logs `debugLog('perf', 'JS bloqué ${ms} ms (${context()})')` — message English is fine too, but keep the journal style (existing lines are English). Use: `JS thread blocked 742 ms (tab search, track loading)`.
- Context from the store in `App.tsx`: tab, `playerOpen`, `current?.phase`, `searching`.
- Skip ticks while `AppState` is not `active` (timers pause in background; a resume would look like a huge stall).

- [ ] **Step 1: failing tests** with jest fake timers and injected `now`: (a) on-time ticks log nothing; (b) a tick 742 ms late logs one `perf` line containing `742` and the context string; (c) stop() clears the timer; (d) a late tick right after returning from background is not logged.
- [ ] **Step 2:** run `npx jest __tests__/stallWatcher.test.ts` → FAIL (module missing).
- [ ] **Step 3:** implement; wire in `App.tsx` with an effect started once.
- [ ] **Step 4:** tests pass; typecheck, lint.
- [ ] **Step 5:** commit `feat(diagnostics): log JS-thread stalls in the journal`.

### Task 2: Player progress isolated from the player screens

**Files:**
- Modify: `src/ui/MiniPlayer.tsx`, `src/ui/PlayerScreen.tsx`
- Test: `__tests__/screens.test.tsx` (add render-count tests)

**Interfaces:**
- `useProgress` is called only inside small leaf components: in `MiniPlayer.tsx` a `MiniProgress({ preparing, receivedRatio })` rendering the `ProgressBar`; in `PlayerScreen.tsx` a component owning the seek bar and the two time labels. `MiniPlayer` and `PlayerContent` no longer call `useProgress`.
- Gesture handlers that need the position get it at release time with `await TrackPlayer.getProgress()` (or a ref the leaf writes into); not from parent render state.
- The transfer-driven subtitle in `MiniPlayer` (bytes buffered, queue position) and `useByteRate` in `PlayerScreen` move into leaf components too, so a 250 ms transfer update re-renders only them.

- [ ] **Step 1: failing test**: mock `useProgress` with a controllable value; render `MiniPlayer` with a `current` track, count renders of the parent via a `React.Profiler` `onRender` on the root id; after changing progress 5 times, the parent's own commit count stays 1 while the bar shows the new ratio. Same for `PlayerSheet` open.
- [ ] **Step 2:** run the suite → FAIL.
- [ ] **Step 3:** extract the leaf components.
- [ ] **Step 4:** suite passes; typecheck, lint; Review Focus 1 checked by reading the gesture code paths.
- [ ] **Step 5:** commit `perf(player): redraw only the progress bar and transfer status`.

### Task 3: Keep visited tabs mounted

**Files:**
- Modify: `App.tsx`
- Test: `__tests__/screens.test.tsx`

**Interfaces:**
- Home, Search and Library mount on first visit and stay mounted, hidden with `display: 'none'` plus `importantForAccessibility="no-hide-descendants"` and `pointerEvents="none"` when not active. Settings keeps today's mount-on-visit.
- Re-tapping the active tab remounts it (a per-tab `resetKey` counter incremented in `changeTab` when `next === tab`) — keeps "goes back to its root".
- The Home overlay `Banners` and per-tab `Banners` render only for the active tab, as today.

- [ ] **Step 1: failing tests**: (a) visit search → library → search: the SearchScreen instance is the same (a `useRef` id or effect mount counter stays 1); (b) re-tapping search remounts it (counter 2); (c) the hidden tab's root has `display: 'none'`.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3:** implement.
- [ ] **Step 4:** tests pass, full `screens`/`catalogScreens` suites still pass.
- [ ] **Step 5:** commit `perf(ui): keep visited tabs mounted instead of rebuilding them`.

### Task 4: Virtualize the Library's filtered lists

**Files:**
- Modify: `src/ui/LibraryScreen.tsx`
- Test: `__tests__/screens.test.tsx`

**Interfaces:**
- When `filter !== 'all'`, the screen is a `FlatList` of `TrackRow`s (`keyExtractor` = hit key used today, `initialNumToRender` 12, `windowSize` 7) with the header and chips as `ListHeaderComponent` and the caption as part of it. The overview (`filter === 'all'`, ≤ 20 rows) stays a `ScrollView`.
- `onPress` keeps the same `PlayContext` (`items` = the full list, `index` = row index).

- [ ] **Step 1: failing test**: library with 150 history entries, filter "Écoutés récemment": fewer than 150 `TrackRow`s rendered initially; pressing row 3 calls `playTrack` with `context.index === 3` and `items.length === 150`.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3:** implement.
- [ ] **Step 4:** pass; typecheck, lint.
- [ ] **Step 5:** commit `perf(library): virtualize long track lists`.

### Task 5: Blur a small cover behind the full player

**Files:**
- Modify: `src/ui/PlayerScreen.tsx:242` (and `src/ui/track.tsx` if a helper is needed)

**Interfaces:**
- `CoverBackdrop` gets a ≤ 250 px cover (`pickArtwork(artwork, 250)` or the track's medium cover) instead of `largeCoverUri(info)`. Android blurs in software on the decoded bitmap; a 40 px blur of a 250 px image looks the same and costs ~16× fewer pixels. The sharp cover in the middle keeps the large one.

- [ ] **Step 1:** change; existing player tests still pass (update an expected URI if a test pins it).
- [ ] **Step 2:** commit `perf(player): blur a small cover for the backdrop`.

### Task 6: R8 for release builds

**Files:**
- Modify: `android/app/build.gradle` (`enableProguardInReleaseBuilds = true`, `shrinkResources true`), `android/app/proguard-rules.pro` (keep rules only if the smoke test shows a need)

- [ ] **Step 1:** `cd android && ./gradlew assembleRelease --no-daemon` (laptop: JDK 21 env from the memory notes) → BUILD SUCCESSFUL; note APK size before/after.
- [ ] **Step 2:** install on emulator `soulstream`, fake network (after-compact.md §7): login, search, play a track, notification controls, Réglages → Journal (exit-reason module), share link intent. No crash in `adb logcat -s AndroidRuntime ReactNativeJS`.
- [ ] **Step 3:** if anything breaks, add the narrowest `-keep` rule; if it cannot be made safe quickly, revert this task and say so.
- [ ] **Step 4:** commit `build(android): shrink the release build with R8`.

### Task 7: Publish and document

**Files:**
- Modify: `android/app/build.gradle`, `package.json` (1.3-beta15 / 18), `docs/performance-audit.md` (new findings rows 12–17 incl. the dropped native inflate with its numbers), `TODO.md` §2 (what's left: friend's report), `AGENTS.md` if it describes anything changed.

- [ ] **Step 1:** full `npm test`, typecheck, lint.
- [ ] **Step 2:** commit `chore: version 1.3-beta15`; build; emulator smoke test (Task 6 list).
- [ ] **Step 3:** `node tools/showcase.mjs android/app/build/outputs/apk/release/app-release.apk`; commit `build: publish 1.3-beta15 APK for testing (low-end performance)`.
- [ ] **Step 4:** docs commit; send `releases/SoulStream.apk` to the user (`SendUserFile`, attach). Push only when the user asks.
