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
          stopForegroundGracePeriod: 10,
        },
        capabilities: [
          Capability.Play,
          Capability.Pause,
          Capability.Stop,
          Capability.SeekTo,
        ],
        compactCapabilities: [Capability.Play, Capability.Pause],
        notificationCapabilities: [
          Capability.Play,
          Capability.Pause,
          Capability.Stop,
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
