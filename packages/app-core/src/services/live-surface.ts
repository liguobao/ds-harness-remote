import {
  attentionTokenSchema,
  compareAttentionItems,
  type AttentionDigest,
  type AttentionItem,
  type AttentionMode,
  type AttentionStatus,
  type LiveActivityTokenRegistrationRequest,
  type PushTargetRegistrationRequest,
} from '@dsh-remote/protocol'
import {
  createPushTargetClient,
  type PushTargetFetch,
  type PushTargetResult,
} from '@dsh-remote/client-core'
import {
  buildAttentionDeepLinkUrl,
  buildConversationDeepLinkUrl,
} from '../lib/attention-deeplink'
import { resolveAttentionBackendIdentity } from '../lib/attention-backend'
import { strings } from '../locales/i18n'
import { selectAttentionCounts } from '../state/attention-store'
import { foregroundService } from './foreground-service'

export interface IosLiveActivityPayload {
  hostId: string
  hostName: string
  attentionToken?: string
  phase?: string
  startedAtMs?: number
  paused?: string
  pendingApprovals: number
  pendingQuestions: number
  runningSessions: number
  completedUnread: number
}

export interface DshRemoteLiveActivityNativeModule {
  update?(payload: IosLiveActivityPayload, alert: string | null): Promise<void> | void
  end?(hostId?: string): Promise<void> | void
  getPushTokens?(hostId: string): Promise<{
    activityPushToken?: string
    pushToStartToken?: string
    activityId?: string
  } | null>
}

export interface LiveSurfaceSnapshot {
  hostId?: string
  hostName?: string
  connected: boolean
  appState: string
  notificationsEnabled: boolean
  activeSessionId?: string
  activeMode?: AttentionMode
  items: readonly AttentionItem[]
  digest: AttentionDigest | null
  /** Optional filter for legacy fallback hosts (e.g. watched-session gating). */
  localRunningItem?: () => AttentionItem | undefined
  taskDetail?: (item: AttentionItem) => { statusText: string; startedAtMs: number; isWaitingInput: boolean } | undefined
  shouldNotifyItem?: (item: AttentionItem) => boolean
}

export interface LiveSurfaceForegroundBridge {
  notifyTask(hostId: string, sessionId: string, title: string, body: string): void
  notifyAttention?(hostId: string, deepLinkUrl: string, tag: string, title: string, body: string): void
  clearAttentionAlerts?(hostId: string): Promise<void>
  updateLiveTask(
    hostId: string,
    sessionId: string,
    badge: string,
    title: string,
    statusText: string,
    isWaitingInput: boolean,
    updatedAtMs: number,
    summary: string,
  ): Promise<void>
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
    details?: { phase: string; startedAtMs: number; countText: string },
  ): Promise<void>
  clearLiveTask(): Promise<void>
}

export interface LiveSurfaceReactNativeLike {
  Platform?: { OS?: string }
  NativeModules?: Record<string, unknown>
}

export interface LiveSurfaceDependencies {
  foreground?: LiveSurfaceForegroundBridge
  getReactNative?: () => LiveSurfaceReactNativeLike | undefined
}

const ACTIVE_LIVE_STATUSES: ReadonlySet<AttentionStatus> = new Set([
  'waiting_question',
  'waiting_approval',
  'running',
])

const ALERTABLE_STATUSES: ReadonlySet<AttentionStatus> = new Set([
  'waiting_question',
  'waiting_approval',
  'completed_unread',
  'failed_unread',
])

function defaultGetReactNative(): LiveSurfaceReactNativeLike | undefined {
  try {
    const rn = require('react-native') as LiveSurfaceReactNativeLike
    if (rn.Platform?.OS !== 'ios') return rn
    const expo = require('expo') as typeof import('expo')
    return { Platform: rn.Platform, NativeModules: {
      DshRemoteLiveActivity: expo.requireOptionalNativeModule('DshRemoteLiveActivity'),
    } }
  } catch {
    return undefined
  }
}

function getIosLiveActivityModule(
  getReactNative: () => LiveSurfaceReactNativeLike | undefined,
): DshRemoteLiveActivityNativeModule | undefined {
  const rn = getReactNative()
  if (rn?.Platform?.OS !== 'ios') return undefined
  const mod = rn.NativeModules?.DshRemoteLiveActivity
  if (typeof mod !== 'object' || mod === null) return undefined
  return mod as DshRemoteLiveActivityNativeModule
}

/** Compact single-character badge matching Android notification and iOS Live Activity badges. */
export function attentionItemBadge(item: Pick<AttentionItem, 'backend' | 'acpAdapter'>): string {
  return resolveAttentionBackendIdentity(item).shortBadge
}

/**
 * Selects the deep link URL for an attention surface:
 * uses `dshremote://attention?host=...&token=...` when a valid opaque token is present on
 * the digest, falling back to `dshremote://conversation?host=...&session=...&mode=...`.
 */
export function selectAttentionDeepLink(
  hostId: string,
  item: AttentionItem | undefined,
  digest: AttentionDigest | null,
): string {
  const token = digest?.attentionToken
  if (token !== undefined && attentionTokenSchema.safeParse(token).success) {
    return buildAttentionDeepLinkUrl(hostId, token)
  }
  if (item !== undefined) {
    return buildConversationDeepLinkUrl(hostId, item.sessionId, item.mode)
  }
  return buildAttentionDeepLinkUrl(hostId)
}

function statusTextForLiveItem(status: AttentionStatus): string {
  switch (status) {
    case 'waiting_approval':
      return strings.attention.statusApproval
    case 'waiting_question':
      return strings.attention.statusQuestion
    case 'failed_unread':
      return strings.attention.statusFailed
    case 'completed_unread':
      return strings.attention.statusCompleted
    case 'running':
      return strings.comfort.liveTaskRunning
  }
}

function notificationBodyForItem(item: AttentionItem): string {
  const platform = resolveAttentionBackendIdentity(item).label
  let action: string
  switch (item.status) {
    case 'waiting_approval':
      action = strings.attention.notifyApproval
      break
    case 'waiting_question':
      action = strings.attention.notifyQuestion
      break
    case 'failed_unread':
      action = strings.attention.notifyFailed
      break
    case 'completed_unread':
      action = strings.attention.notifyCompleted
      break
    case 'running':
      action = strings.comfort.liveTaskRunning
      break
  }
  const base = `${platform} · ${action}`
  return item.summary ? `${base} · ${item.summary}` : base
}

export interface LiveSurfaceController {
  sync(snapshot: LiveSurfaceSnapshot): Promise<void>
  clear(): Promise<void>
  dispose(): Promise<void>
}

/**
 * Single owner of Android Live Task notifications, deduplicated Attention alerts,
 * automatic alert clearing, and optional iOS Live Activity updates.
 */
export function createLiveSurfaceController(
  deps: LiveSurfaceDependencies = {},
): LiveSurfaceController {
  const fgs: LiveSurfaceForegroundBridge = deps.foreground ?? foregroundService
  const getRn = deps.getReactNative ?? defaultGetReactNative

  let disposed = false
  let lastLiveKey: string | undefined
  let lastHostId: string | undefined
  const ios = getIosLiveActivityModule(getRn)
  let tail: Promise<void> = Promise.resolve()
  const seenAlertKeys = new Set<string>()
  const previousUrgentCountByHost = new Map<string, number>()

  const enqueue = (task: () => Promise<void>): Promise<void> => {
    tail = tail.then(task).catch(() => undefined)
    return tail
  }

  const clearSurfaces = (hostId?: string): Promise<void> => {
    if (lastLiveKey === '' || (lastLiveKey === undefined && !ios)) return tail
    lastLiveKey = ''
    return enqueue(async () => {
      await fgs.clearLiveTask().catch(() => undefined)
      if (ios?.end !== undefined) {
        try {
          await ios.end(hostId)
        } catch {
          // Best-effort iOS Live Activity end.
        }
      }
    })
  }

  return {
    sync(snapshot: LiveSurfaceSnapshot): Promise<void> {
      if (disposed) return Promise.resolve()
      const { hostId, connected, appState, notificationsEnabled, activeSessionId, activeMode, items, digest } = snapshot

      if (!connected || !hostId) {
        if (lastHostId !== undefined) {
          seenAlertKeys.clear()
          previousUrgentCountByHost.delete(lastHostId)
          lastHostId = undefined
        }
        return clearSurfaces()
      }

      if (lastHostId !== undefined && lastHostId !== hostId) {
        seenAlertKeys.clear()
      }
      const previousHost = lastHostId
      lastHostId = hostId

      const sorted = [...items].sort(compareAttentionItems)
      const counts = selectAttentionCounts(sorted)

      // 1. Automatically clear pending alerts when urgent approvals/questions drop to 0
      const urgentCount = counts.pendingApprovals + counts.pendingQuestions
      const prevUrgent = previousUrgentCountByHost.get(hostId) ?? 0
      previousUrgentCountByHost.set(hostId, urgentCount)
      let clearAlertsPromise: Promise<void> | undefined
      if (prevUrgent > 0 && urgentCount === 0 && typeof fgs.clearAttentionAlerts === 'function') {
        clearAlertsPromise = enqueue(async () => {
          await fgs.clearAttentionAlerts?.(hostId)
        })
      }

      // 2. Deduplicated alerts for newly arrived waiting/completed/failed items
      const currentAlertKeys = new Set<string>()
      const topUrgent = sorted.find(
        item => item.status === 'waiting_question' || item.status === 'waiting_approval',
      )

      let iosAlert: string | null = null
      for (const item of sorted) {
        if (!ALERTABLE_STATUSES.has(item.status)) continue
        const key = `${hostId}:${item.id}:${item.status}`
        currentAlertKeys.add(key)
        if (seenAlertKeys.has(key)) continue
        seenAlertKeys.add(key)

        const viewingThisSession = appState === 'active'
          && activeSessionId === item.sessionId
          && (activeMode === undefined || activeMode === item.mode)
        if (!notificationsEnabled || viewingThisSession) continue
        if (snapshot.shouldNotifyItem !== undefined && !snapshot.shouldNotifyItem(item)) continue

        if (ios) {
          iosAlert ??= statusTextForLiveItem(item.status)
          continue
        }

        const useDigestToken = topUrgent?.id === item.id
          && digest?.attentionToken !== undefined
          && attentionTokenSchema.safeParse(digest.attentionToken).success
        const deepLink = useDigestToken
          ? buildAttentionDeepLinkUrl(hostId, digest!.attentionToken)
          : buildConversationDeepLinkUrl(hostId, item.sessionId, item.mode)
        const title = item.sessionTitle.trim().length > 0
          ? item.sessionTitle.trim()
          : strings.comfort.liveTaskDefaultTitle
        const body = notificationBodyForItem(item)
        const tag = `attention:${hostId}:${item.sessionId}`

        if (typeof fgs.notifyAttention === 'function') {
          fgs.notifyAttention(hostId, deepLink, tag, title, body)
        } else {
          fgs.notifyTask(hostId, item.sessionId, title, body)
        }
      }

      // Prune disappeared keys so a subsequent turn/approval on the same session can alert again.
      for (const existing of [...seenAlertKeys]) {
        if (!currentAlertKeys.has(existing)) {
          seenAlertKeys.delete(existing)
        }
      }

      const activeItems = sorted.filter(item => ACTIVE_LIVE_STATUSES.has(item.status))
      const topActive = activeItems[0] ?? (!ios ? snapshot.localRunningItem?.() : undefined)
      const detail = topActive?.status === 'running' ? snapshot.taskDetail?.(topActive) : undefined
      const phase = detail && !detail.isWaitingInput ? detail.statusText
        : topActive ? statusTextForLiveItem(topActive.status) : undefined
      const startedAtMs = detail && !detail.isWaitingInput ? detail.startedAtMs : 0

      if (ios) {
        const summary = digest ?? { ...counts, completedUnread: counts.completedUnread + counts.failedUnread }
        if (!notificationsEnabled || !(summary.pendingApprovals || summary.pendingQuestions || summary.runningSessions || summary.completedUnread)) {
          return clearSurfaces(previousHost === hostId ? hostId : undefined)
        }
        const payload: IosLiveActivityPayload = {
          hostId,
          hostName: snapshot.hostName ?? hostId,
          pendingApprovals: Math.min(99, summary.pendingApprovals),
          pendingQuestions: Math.min(99, summary.pendingQuestions),
          runningSessions: Math.min(99, summary.runningSessions),
          completedUnread: Math.min(99, summary.completedUnread),
          attentionToken: digest?.attentionToken,
          ...(phase ? { phase, startedAtMs, paused: strings.comfort.liveTaskPaused } : {}),
        }
        const key = JSON.stringify([payload, appState, Math.floor(Date.now() / 60_000)])
        if (lastLiveKey === key && iosAlert === null) return tail
        lastLiveKey = key
        return enqueue(async () => {
          try {
            await ios.update?.(payload, iosAlert)
          } catch {
            if (lastLiveKey === key) lastLiveKey = undefined
          }
        })
      }

      // Android displays the same attention item selected above.

      if (topActive === undefined) {
        const clearPromise = clearSurfaces(hostId)
        return clearAlertsPromise ? Promise.all([clearAlertsPromise, clearPromise]).then(() => undefined) : clearPromise
      }

      const extraCount = Math.max(0, activeItems.length - 1)
      const isWaitingInput = topActive.status === 'waiting_approval' || topActive.status === 'waiting_question'
      const badge = attentionItemBadge(topActive)
      const title = topActive.sessionTitle.trim().length > 0
        ? topActive.sessionTitle.trim()
        : strings.comfort.liveTaskDefaultTitle
      const statusText = `${resolveAttentionBackendIdentity(topActive).label} · ${phase}`
      const summary = topActive.summary ?? ''
      const updatedAtMs = topActive.updatedAt > 0 ? topActive.updatedAt : 0
      const deepLinkUrl = selectAttentionDeepLink(hostId, topActive, digest)

      const payload = {
        hostId,
        deepLinkUrl,
        badge,
        title,
        statusText,
        isWaitingInput,
        updatedAtMs,
        summary,
        extraCount,
        details: { phase: phase!, startedAtMs, countText: counts.runningSessions > 1 ? strings.comfort.liveTaskCount(counts.runningSessions) : '' },
        pendingApprovals: counts.pendingApprovals,
        pendingQuestions: counts.pendingQuestions,
        runningSessions: counts.runningSessions,
        completedUnread: counts.completedUnread,
      }
      const nextKey = JSON.stringify(payload)
      if (nextKey === lastLiveKey) {
        return clearAlertsPromise ?? tail
      }

      lastLiveKey = nextKey
      return enqueue(async () => {
        if (disposed) return
        try {
          if (typeof fgs.updateLiveTaskV2 === 'function') {
            await fgs.updateLiveTaskV2(
              payload.hostId,
              payload.deepLinkUrl,
              payload.badge,
              payload.title,
              payload.statusText,
              payload.isWaitingInput,
              payload.updatedAtMs,
              payload.summary,
              payload.extraCount,
              payload.details,
            )
          } else {
            await fgs.updateLiveTask(
              payload.hostId,
              topActive.sessionId,
              payload.badge,
              payload.title,
              payload.statusText,
              payload.isWaitingInput,
              payload.updatedAtMs,
              payload.summary,
            )
          }
        } catch {
          if (lastLiveKey === nextKey) lastLiveKey = undefined
        }
      })
    },

    clear(): Promise<void> {
      seenAlertKeys.clear()
      previousUrgentCountByHost.clear()
      lastHostId = undefined
      return clearSurfaces()
    },

    dispose(): Promise<void> {
      const clearPromise = clearSurfaces(lastHostId)
      disposed = true
      seenAlertKeys.clear()
      previousUrgentCountByHost.clear()
      lastHostId = undefined
      return clearPromise
    },
  }
}

export interface SyncPushTokensParams {
  baseUrl: string
  accessToken: string
  pushWakeSupported: boolean
  pushTarget?: PushTargetRegistrationRequest
  hostId?: string
  liveActivity?: LiveActivityTokenRegistrationRequest
  fetchImpl?: PushTargetFetch
  signal?: AbortSignal
}

export interface SyncPushTokensResult {
  pushTarget?: PushTargetResult
  liveActivity?: PushTargetResult
  skippedUnsupported: boolean
}

/**
 * Registers device wake push token and/or iOS Live Activity push token with the
 * Hosted Server ONLY when the server negotiated `push.wake.v1` in `hello.ack`.
 */
export async function syncPushTokensIfSupported(
  params: SyncPushTokensParams,
): Promise<SyncPushTokensResult> {
  if (!params.pushWakeSupported) {
    return { skippedUnsupported: true }
  }
  const client = createPushTargetClient(
    params.baseUrl,
    params.accessToken,
    params.fetchImpl,
  )
  const result: SyncPushTokensResult = { skippedUnsupported: false }
  if (params.pushTarget !== undefined) {
    result.pushTarget = await client.registerPushTarget(params.pushTarget, { signal: params.signal })
  }
  if (params.hostId !== undefined && params.liveActivity !== undefined) {
    result.liveActivity = await client.registerLiveActivityToken(
      params.hostId,
      params.liveActivity,
      { signal: params.signal },
    )
  }
  return result
}
