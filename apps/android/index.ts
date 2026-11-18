import './src/polyfills';
import { registerRootComponent } from 'expo';
import { registerGlobals } from 'react-native-webrtc';
import { AppRegistry } from 'react-native';
import { foregroundService } from './src/services/foreground-service';

import App from './App';

registerGlobals();

// An FGS alone does not stop RN from pausing timers on Activity.onPause.
// The native service owns this task's lifetime and releases it on disconnect.
AppRegistry.registerHeadlessTask('DshRemoteConnection', () => ({ lifetimeId }: { lifetimeId: string }) => foregroundService.waitUntilStopped(lifetimeId));

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
