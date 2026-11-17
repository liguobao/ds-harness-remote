import '@dsh-remote/app-core/polyfills';
import { registerRootComponent } from 'expo';
import { registerGlobals } from 'react-native-webrtc';

import App from '@dsh-remote/app-core/app';

registerGlobals();

// No AppRegistry.registerHeadlessTask here: the 'DshRemoteConnection' headless
// task exists only to keep the Android foreground service's JS context alive.
// iOS has no equivalent; background execution is limited to the short
// UIApplication background task granted by plugins/with-background-connection-grace.

registerRootComponent(App);
