interface ForegroundServiceModule {
  start(): Promise<void>
  stop(): Promise<void>
  waitUntilStopped(lifetimeId: string): Promise<void>
}

function reactNative(): typeof import('react-native') | undefined {
  // Keep Node/Vitest service tests independent from React Native's native
  // entrypoint. Metro resolves this require in the Android bundle.
  try {
    return require('react-native') as typeof import('react-native')
  } catch {
    return undefined
  }
}

function nativeModule(rn: typeof import('react-native')): ForegroundServiceModule {
  const native = rn.NativeModules.DshRemoteForegroundService as ForegroundServiceModule | undefined
  if (native === undefined) throw new Error('Android connection service is missing. Rebuild and reinstall the APK.')
  return native
}

/** iOS/web/Node skip this Android-only service; Android requires a rebuilt native module. */
export const foregroundService = {
  async start(): Promise<void> {
    const rn = reactNative()
    if (rn?.Platform.OS !== 'android') return
    const native = nativeModule(rn)
    // Notification denial does not prohibit an FGS, but without this request
    // Android 13+ hides its notification from the drawer.
    if (Number(rn.Platform.Version) >= 33 && rn.AppState.currentState === 'active') {
      const permission = rn.PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS
      if (!await rn.PermissionsAndroid.check(permission)) await rn.PermissionsAndroid.request(permission)
    }
    await native.start()
  },
  async stop(): Promise<void> {
    const rn = reactNative()
    if (rn?.Platform.OS !== 'android') return
    await nativeModule(rn).stop()
  },
  async waitUntilStopped(lifetimeId: string): Promise<void> {
    const rn = reactNative()
    if (rn?.Platform.OS !== 'android') return
    await nativeModule(rn).waitUntilStopped(lifetimeId)
  },
}

