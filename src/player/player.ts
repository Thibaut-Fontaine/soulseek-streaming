import TrackPlayer, {
  AppKilledPlaybackBehavior,
  Capability,
  IOSCategory,
  IOSCategoryOptions,
} from 'react-native-track-player';

let playerSetup: Promise<void> | null = null;

/**
 * Initialise the native player once per app launch.
 *
 * The player is fed by the local range server (127.0.0.1), so it benefits from
 * background playback, lock-screen controls, and the OS media session.
 */
export function ensurePlayer(): Promise<void> {
  if (!playerSetup) {
    playerSetup = (async () => {
      try {
        await TrackPlayer.setupPlayer({
          autoHandleInterruptions: true,
          minBuffer: 5,
          maxBuffer: 30,
          playBuffer: 2,
          backBuffer: 0,
          iosCategory: IOSCategory.Playback,
          iosCategoryOptions: [
            IOSCategoryOptions.AllowBluetooth,
            IOSCategoryOptions.AllowAirPlay,
          ],
        });
      } catch (error) {
        // setupPlayer throws if it was already initialised (e.g. fast reload).
        if (!/already/i.test(String(error))) {
          throw error;
        }
      }

      await TrackPlayer.updateOptions({
        android: {
          appKilledPlaybackBehavior: AppKilledPlaybackBehavior.ContinuePlayback,
          // Between two tracks the player is idle while the next one's
          // sources are found and buffered. Past this grace the service
          // leaves the foreground, and Android 12+ will not let it come back
          // with the screen locked: cover a slow lookup with fallbacks.
          stopForegroundGracePeriod: 60,
        },
        // Previous / play-pause / next, like other music apps. The native
        // queue holds one track: the store handles the skip buttons
        // (Event.RemoteNext / RemotePrevious in state/store.ts).
        capabilities: [
          Capability.Play,
          Capability.Pause,
          Capability.SkipToNext,
          Capability.SkipToPrevious,
          Capability.Stop,
          Capability.SeekTo,
        ],
        compactCapabilities: [Capability.SkipToPrevious, Capability.Play, Capability.Pause, Capability.SkipToNext],
        notificationCapabilities: [
          Capability.SkipToPrevious,
          Capability.Play,
          Capability.Pause,
          Capability.SkipToNext,
          Capability.SeekTo,
        ],
        progressUpdateEventInterval: 0.5,
      });
    })().catch(error => {
      playerSetup = null;
      throw error;
    });
  }

  return playerSetup;
}

export async function resetPlayer(): Promise<void> {
  try {
    await TrackPlayer.reset();
  } catch {
    // The player may not be set up yet.
  }
}
