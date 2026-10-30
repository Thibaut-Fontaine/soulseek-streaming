import TrackPlayer, { Event } from 'react-native-track-player';

/**
 * Background playback service, run by TrackPlayer as a headless task. Keep
 * it free of React and app state.
 */
export async function playbackService(): Promise<void> {
  TrackPlayer.addEventListener(Event.RemotePlay, () => {
    TrackPlayer.play().catch(() => {});
  });

  TrackPlayer.addEventListener(Event.RemotePause, () => {
    TrackPlayer.pause().catch(() => {});
  });

  TrackPlayer.addEventListener(Event.RemoteStop, () => {
    TrackPlayer.stop().catch(() => {});
  });

  TrackPlayer.addEventListener(Event.RemoteSeek, event => {
    TrackPlayer.seekTo(event.position).catch(() => {});
  });

  // Never resolve: React Native fires JS timers in the background (screen
  // locked) only while a headless task runs, and this service is one. If it
  // ended, the source search for the next track (timed) would never finish
  // with the screen locked, and the next song would not start.
  await new Promise<never>(() => {});
}
