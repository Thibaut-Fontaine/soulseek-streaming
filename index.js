/**
 * @format
 */

import { AppRegistry } from 'react-native';
import TrackPlayer from 'react-native-track-player';

import App from './App';
import { name as appName } from './app.json';
import { installCrashHandler } from './src/services/crashReport';

// First, so a crash anywhere below is recorded (Réglages → Journal).
installCrashHandler();

AppRegistry.registerComponent(appName, () => App);

// Runs in a separate JS context while audio plays in the background.
TrackPlayer.registerPlaybackService(
  () => require('./src/player/service').playbackService,
);
