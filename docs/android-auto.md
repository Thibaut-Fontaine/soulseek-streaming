# Android Auto (feature 8)

Status: **browse tree and native service implemented; JVM tests pass; no
DHU/device test run** (no Android Auto head unit or DHU in this session).

## What is in the app

- `src/core/autoBrowse.ts` — pure browse tree over the user's data:
  - `Bibliothèque` → `Titres likés`, `Écoutés récemment`;
  - `Sur l’appareil` (downloads and imported files);
  - `Téléchargés` (same local files today; the folder exists so the
    library/device/cache contract is stable);
  - each folder is capped (`maxItems`, 200 by default) to keep the binder
    payload small. Items carry title, artist, album, duration and artwork.
- `src/services/androidAuto.ts` — pushes the tree and playback state to the
  native service every 2 s (and immediately on a store change), listens for
  car commands and maps them to the **existing** player: `playTrack`,
  `playNext`, `playPrevious`, `stopPlayback`, `TrackPlayer.play/pause/seekTo`.
  Media ids are resolved against the current library/device lists, never by
  passing peer paths through the car.
- `android/app/src/main/java/com/soulstream/app/auto/`:
  - `AutoBrowseNode.kt` — pure Kotlin model, `find`/`childrenOf`, action enum;
  - `AutoSnapshot.kt` — JSON snapshot ↔ SharedPreferences;
  - `AutoBridge.kt` — commands to JS, with a small pending queue;
  - `SoulStreamMediaService.kt` — `MediaBrowserServiceCompat` +
    `MediaSessionCompat`; `onGetRoot`/`onLoadChildren` serve the tree and
    transport callbacks emit car commands to JS.
- `AutoModule.kt` — React Native module `SoulStreamAuto` (`update`, event
  emitter); registered in `MainApplication`.
- Manifest: `com.google.android.gms.car.application` metadata pointing to
  `res/xml/automotive_app_desc.xml` (`<uses name="media"/>`) and the
  `android.media.browse.MediaBrowserService` intent filter on the service.
- `androidx.media:media:1.6.0` and JUnit 4.13.2 (unit tests only).

## Tests run

```bash
npx jest __tests__/autoBrowse.test.ts --runInBand
cd android && ./gradlew :app:testDebugUnitTest --no-daemon --offline
```

Result: 3 JS tree tests and 3 JVM `AutoBrowseNodeTest` tests pass; the Kotlin
service and RN module compile in the debug unit-test build.

## Known limitation: two media sessions

react-native-track-player owns the notification/lock-screen `MediaSession`.
The Android Auto service owns its own `MediaSessionCompat` because a
`MediaBrowserService` needs a session token. Both drive the same Zustand
state only through the bridge, but a head unit may show the car session while
the phone shows track-player's. The car controls still reach the same player;
if the two sessions fight over hardware media buttons on a real device, the
next step is to make TrackPlayer's session secondary (or mirror its state into
the service instead of the JS snapshot).

## DHU / device test plan (owner, not run here)

1. Build and install a debug or release APK; play a few tracks and like one
   so all folders have content.
2. On the phone: Android Auto app → Settings → tap Version 10 times →
   Developer settings → **Start head unit server**.
3. On the workstation: `adb forward tcp:5277 tcp:5277`, then run the Desktop
   Head Unit (`desktop-head-unit`) and connect to `localhost:5277`.
4. In the DHU, open **SoulStream** and check the root folders, titles and
   artwork. Empty folders must not crash the browser.
5. Tap a track from each folder: playback starts, metadata/artwork show, and
   pause / play / next / previous / seek act on the phone's current player.
6. While playing, leave and re-enter the car UI; then cold-start the app from
   the car. Commands sent before JS is ready are queued (up to 20) by
   `AutoBridge`; a cold-start tap should still play once the bridge attaches.
7. Offline: browse still works from the local snapshot; playing a network
   track shows the usual notice instead of a crash.

An instrumented test (`androidTest`) would need a device/emulator and the
Android Auto test harness; it was not added in this lot. The JVM test covers
the pure tree/command contract, and the DHU run above is the acceptance test.
