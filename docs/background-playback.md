# Background playback: next song with the screen locked

Status (2026-10-30): workaround shipped in 1.3-beta18 (`c8aad3b`). Read this
if a report says the next song still does not start with the screen locked.

## The report

With the screen locked, the next song sometimes did not start. Not
reproduced on the owner's phone (it stayed unlocked); the reporter is sure
it happens only after a couple of tracks, never on the first change.

## Why it happens

Between two songs the native player is idle and JS does all the work:
Soulseek source search, peer connection, buffering (`playNext` →
`playCatalog` / `startHit` in `src/state/store.ts`). Two things break that
window when the app is in the background:

1. **JS timers stop.** React Native's `JavaTimerManager` fires `setTimeout`
   / `setInterval` while the activity is paused (screen locked) only if a
   headless JS task is running. track-player's playback service is one, but
   `playbackService` returned at once, so the task ended. Starting a track
   runs on network events, so a song whose sources were found before
   locking still played; the source search for the one after ends on a
   timer and never finished. Hence "after a couple of tracks".
2. **The service leaves the foreground.** track-player demotes its service
   `stopForegroundGracePeriod` seconds (was 10) after the player stops
   playing. A slow lookup between tracks exceeded it, and Android 12+ will
   not let a service return to the foreground from the background
   (`ForegroundServiceStartNotAllowedException`, reported by track-player
   as `android-foreground-service-start-not-allowed`). The app can then be
   frozen.

## What 1.3-beta18 does

- `src/player/service.ts`: the playback service never resolves, so the
  headless task stays active and timers keep firing in the background.
  Legitimate use of the headless task API (track-player starts it with no
  timeout), but it relies on React Native internals; a safety net, not the
  pattern to build on. Costs a little battery while the app is in the
  background (timer frames keep ticking).
- `src/player/player.ts`: `stopForegroundGracePeriod` 10 → 60 s.
- Journal: each automatic track change logs
  `fin du morceau, suivant (application background|active)`
  (`play` tag), so a shared journal shows whether a failure happened in
  the background.
- Since 1.3-beta17 the next song is pre-downloaded into the track cache
  once the current one is complete (`prefetchNext`), so most changes start
  from the device without any network step.

## How native music apps do it

Spotify, Deezer, YouTube Music and the like:

- Playback lives in a foreground **media service** (Media3
  `MediaSessionService`, type `mediaPlayback`); the queue and the
  next-track logic run natively in that service, independent of the UI.
- The **player holds the upcoming tracks**: the app hands it the next ones
  ahead of time and the player moves on by itself, gaplessly, still
  "playing". The service never goes idle, so it never leaves the
  foreground and the Android 12+ restriction never applies.
- **Wake locks come from the player**: `setWakeMode(WAKE_MODE_NETWORK)`
  holds a CPU and Wi-Fi lock while playing or buffering.
- The next track's stream (or file) is resolved and preloaded while the
  current one plays.
- Timers and background work are native (Handler, coroutines);
  deferrable work goes to WorkManager.

In React Native apps the usual pattern with react-native-track-player is
the same: several tracks in the native queue, JS never needed at a track
end. Apps that need background timers often use a native timer module
(e.g. react-native-background-timer).

SoulStream is harder: our native queue holds one track, and the next one
needs a Soulseek search and a P2P transfer driven from JS.

## If the issue persists: next steps, in order

1. **Put the pre-downloaded next song in the native queue.** Once
   `prefetchNext` has saved it to the cache, `TrackPlayer.add` its
   `file://` URL after the current track. The player then changes track
   natively and gaplessly, without JS and still in the foreground. Watch:
   the store's `current` / queue / context must follow the native
   `PlaybackActiveTrackChanged` event instead of `PlaybackQueueEnded`, and
   skip / previous / stop must keep the native queue in sync.
2. **Set the player's wake mode.** track-player 4.1.2 does not expose it;
   we already patch it (`patches/react-native-track-player+4.1.2.patch`),
   so add `setWakeMode(C.WAKE_MODE_NETWORK)` on its ExoPlayer, after
   checking how its kotlin-audio layer builds the player.
3. **Keep the beta18 workaround** for changes that could not be
   pre-downloaded in time (slow peer, very short track).
4. **Longer term: native data path.** Soulseek transfers in Kotlin inside
   the service, like native apps. Large; also listed in `TODO.md` §2 as the
   fix for start stutters on modest phones.

To check a report: ask for the journal (Réglages → Journal de débogage →
Partager) and look for the `fin du morceau, suivant (application
background)` line, then the `play` lines after it (did the source search
end? `étape … source(s)`), and any `player` error
`android-foreground-service-start-not-allowed`.
