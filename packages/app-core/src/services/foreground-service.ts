interface ForegroundServiceModule {
  notifyTask(hostId: string, sessionId: string, title: string, body: string): void
  notifyAttention?(hostId: string, deepLinkUrl: string, tag: string, title: string, body: string): void
  clearAttentionAlerts?(hostId: string): Promise<void> | void
  start(): Promise<void>
  stop(): Promise<void>
  setStatus(status: string): Promise<void>
  waitUntilStopped(lifetimeId: string): Promise<void>
  isIgnoringBatteryOptimizations?(): Promise<boolean>
  requestIgnoreBatteryOptimizations?(): Promise<boolean>
  updateLiveTask?(hostId: string, sessionId: string, badge: string, title: string, statusText: string, isWaitingInput: boolean, updatedAtMs: number, summary: string): Promise<void>
  updateLiveTaskV2?(
    hostId: string,
    deepLinkUrl: string,
    badge: string,
    title: string,
    statusText: string,
    isWaitingInput: boolean,
    updatedAtMs: number,
    summary: string,
    extraCount: number,
  ): Promise<void>
  clearLiveTask?(): Promise<void>
}

function legacySessionIdFromDeepLink(deepLinkUrl: string): string {
  try {
    const parsed = new URL(deepLinkUrl)
    return parsed.searchParams.get('session') ?? ''
  } catch {
    return ''
  }
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
  notifyTask(hostId: string, sessionId: string, title: string, body: string): void {
    const rn = reactNative()
    if (rn?.Platform.OS !== 'android') return
    nativeModule(rn).notifyTask(hostId, sessionId, title.slice(0, 100), body)
  },
  notifyAttention(hostId: string, deepLinkUrl: string, tag: string, title: string, body: string): void {
    const rn = reactNative()
    if (rn?.Platform.OS !== 'android') return
    const native = rn.NativeModules.DshRemoteForegroundService as ForegroundServiceModule | undefined
    if (native === undefined) return
    const safeTitle = title.slice(0, 100)
    if (typeof native.notifyAttention === 'function') {
      native.notifyAttention(hostId, deepLinkUrl, tag, safeTitle, body)
      return
    }
    native.notifyTask(hostId, legacySessionIdFromDeepLink(deepLinkUrl), safeTitle, body)
  },
  async clearAttentionAlerts(hostId: string): Promise<void> {
    const rn = reactNative()
    if (rn?.Platform.OS !== 'android') return
    try {
      const native = rn.NativeModules.DshRemoteForegroundService as ForegroundServiceModule | undefined
      await native?.clearAttentionAlerts?.(hostId)
    } catch {
      // Best-effort clear; older APKs without clearAttentionAlerts safely no-op.
    }
  },
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
  async setStatus(status: 'connecting' | 'connected' | 'reconnecting'): Promise<void> {
    const rn = reactNative()
    if (rn?.Platform.OS !== 'android') return
    await nativeModule(rn).setStatus(status)
  },
  async waitUntilStopped(lifetimeId: string): Promise<void> {
    const rn = reactNative()
    if (rn?.Platform.OS !== 'android') return
    await nativeModule(rn).waitUntilStopped(lifetimeId)
  },
  async isIgnoringBatteryOptimizations(): Promise<boolean> {
    const rn = reactNative()
    if (rn?.Platform.OS !== 'android') return false
    try {
      return (await nativeModule(rn).isIgnoringBatteryOptimizations?.()) ?? false
    } catch {
      return false
    }
  },
  async requestIgnoreBatteryOptimizations(): Promise<boolean> {
    const rn = reactNative()
    if (rn?.Platform.OS !== 'android') return true
    try {
      return (await nativeModule(rn).requestIgnoreBatteryOptimizations?.()) ?? false
    } catch {
      return false
    }
  },
  async updateLiveTask(
    hostId: string,
    sessionId: string,
    badge: string,
    title: string,
    statusText: string,
    isWaitingInput: boolean,
    updatedAtMs: number,
    summary: string,
  ): Promise<void> {
    const rn = reactNative()
    if (rn?.Platform.OS !== 'android') return
    try {
      const native = rn.NativeModules.DshRemoteForegroundService as ForegroundServiceModule | undefined
      await native?.updateLiveTask?.(hostId, sessionId, badge, title, statusText, isWaitingInput, updatedAtMs, summary)
    } catch {
      // Best-effort live task update.
    }
  },
  async updateLiveTaskV2(
    hostId: string,
    deepLinkUrl: string,
    badge: string,
    title: string,
    statusText: string,
    isWaitingInput: boolean,
    updatedAtMs: number,
    summary: string,
    extraCount: number,
  ): Promise<void> {
    const rn = reactNative()
    if (rn?.Platform.OS !== 'android') return
    try {
      const native = rn.NativeModules.DshRemoteForegroundService as ForegroundServiceModule | undefined
      if (native === undefined) return
      if (typeof native.updateLiveTaskV2 === 'function') {
        await native.updateLiveTaskV2(
          hostId,
          deepLinkUrl,
          badge,
          title,
          statusText,
          isWaitingInput,
          updatedAtMs,
          summary,
          Math.max(0, Math.floor(extraCount)),
        )
        return
      }
      await native.updateLiveTask?.(
        hostId,
        legacySessionIdFromDeepLink(deepLinkUrl),
        badge,
        title,
        statusText,
        isWaitingInput,
        updatedAtMs,
        summary,
      )
    } catch {
      // Best-effort live task update.
    }
  },
  async clearLiveTask(): Promise<void> {
    const rn = reactNative()
    if (rn?.Platform.OS !== 'android') return
    try {
      const native = rn.NativeModules.DshRemoteForegroundService as ForegroundServiceModule | undefined
      await native?.clearLiveTask?.()
    } catch {
      // Best-effort live task clear.
    }
  },
}

