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

// Headless task that keeps JS timers running in the background (see the file).
TrackPlayer.registerPlaybackService(
  () => require('./src/player/service').playbackService,
);
