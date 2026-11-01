import { reduceCodexTimelineFrame } from '@dsh-remote/client-core'
import { strings as zhCN } from '../locales/i18n'
import {
  codexItemsToChat,
  codexPermissionPresetFromResponse,
  mergeCodexLive,
  updateCodexSession,
  withCodexPermission,
} from '../services/codex'
import { applyCursorFrame, cursorNativeId } from '../services/cursor'
import type { ChatItem, RemoteSession } from '../types'
import { applyMuxFrameToMessages, sessionRunningForMuxFrame } from './event-reducer'
import { inboxRpcIds } from './message-helpers'
import type { SessionAccess } from './session-runtime'
import { isHarnessPromptStarted, isRecord } from './session-state'
import type { AppState } from './store-state'

/** SessionEvent actions use the store's single connection/session runtime. */
export function createSessionEventActions({ get, set, runtime }: SessionAccess): Pick<AppState,
  'handleMuxFrame' | 'handleCodexFrame' | 'handleCodexFrames' | 'handleCursorFrame'> {
  return {
    handleMuxFrame(frame) {
      set(state => {
        const sessionId = frame.payload.sessionId
        if (frame.payload.type === 'session/projection' && sessionId !== undefined && typeof frame.payload.key === 'string') {
          const { key, value, seq } = frame.payload
          const previous = state.sessionProjectionSeqs[sessionId]?.[key]
          if (seq !== undefined && previous !== undefined && seq < previous) return {}
          const update = (session: RemoteSession): RemoteSession => session.sessionId !== sessionId ? session : {
            ...session,
            projections: { ...session.projections, values: { ...session.projections?.values, [key]: value } },
          }
          // Only local pending rows follow the inbox. A durable user/message
          // echo is stronger evidence than a delayed control-stream projection.
          // Leaving the inbox may mean execution, steering, or removal; keep the
          // row visible as unconfirmed until an echo/history or explicit action
          // settles it. No second projection or timer is needed for visibility.
          const settle = key === 'inbox' ? (items: ChatItem[]): ChatItem[] => {
            const queued = inboxRpcIds(value)
            return items.map(item => {
              if (item.kind !== 'message' || item.role !== 'user' || !item.id.startsWith('local:')
                || item.nativeSeq !== undefined || item.requestRpcId === undefined || item.sendState === 'canceled') return item
              if (queued.has(item.requestRpcId)) {
                return { ...item, sendState: 'queued', queuedAdopted: true, sendError: undefined }
              }
              if (item.queuedAdopted === true && (item.sendState === 'queued' || item.sendState === undefined)) {
                return { ...item, sendState: 'unconfirmed', sendError: undefined }
              }
              return item
            })
          } : undefined
          return {
            sessions: state.sessions.map(update),
            selectedSession: state.selectedSession === undefined ? undefined : update(state.selectedSession),
            ...(settle === undefined ? {} : {
              messages: {
                ...state.messages,
                [sessionId]: settle(state.messages[sessionId] ?? []),
              },
            }),
            ...(seq === undefined ? {} : {
              sessionProjectionSeqs: {
                ...state.sessionProjectionSeqs,
                [sessionId]: { ...state.sessionProjectionSeqs[sessionId], [key]: seq },
              }
            }),
          }
        }
        const running = sessionRunningForMuxFrame(frame)
        const seq = frame.payload.event?.seq
        const previousLifecycle = sessionId === undefined ? undefined : state.sessionLifecycles[sessionId]
        if (running !== undefined && seq !== undefined && previousLifecycle !== undefined && seq < previousLifecycle.seq) return {}
        const releasePrompt = state.busyAction === 'send-message'
          && sessionId !== undefined
          && state.selectedSession?.sessionId === sessionId
          && (isHarnessPromptStarted(frame) || running !== undefined)
        // Row status marks mirror the official session dots: a finished turn
        // leaves a "done" reminder (green) until the session is opened; a failed
        // turn leaves the red mark instead.
        const turnReason = running === false && frame.payload.event?.type === 'turn/end'
          ? frame.payload.event.data.reason
          : undefined
        const finishedMark = running === undefined ? undefined
          : running ? undefined
            : isRecord(turnReason) && (turnReason.kind === 'failed' || turnReason.kind === 'error') ? 'failed' as const
              : turnReason === undefined ? undefined : 'completed' as const
        const updateRunning = (session: RemoteSession): RemoteSession => (
          sessionId !== undefined && running !== undefined && session.sessionId === sessionId
            ? { ...session, running }
            : session
        )
        return {
          messages: applyMuxFrameToMessages(state.messages, frame),
          ...(sessionId === undefined || running === undefined ? {} : {
            sessions: state.sessions.map(updateRunning),
            selectedSession: state.selectedSession === undefined ? undefined : updateRunning(state.selectedSession),
            ...(seq === undefined ? {} : {
              sessionLifecycles: {
                ...state.sessionLifecycles,
                [sessionId]: {
                  seq,
                  running,
                  ...(frame.payload.event?.data.turn === undefined ? {} : { turn: String(frame.payload.event.data.turn) }),
                  ...(finishedMark === undefined ? {} : { finished: finishedMark }),
                },
              }
            }),
          }),
          ...(releasePrompt ? { busyAction: undefined } : {}),
        }
      })
    },

    handleCodexFrame(frame) {
      get().handleCodexFrames([frame])
    },

    handleCodexFrames(frames) {
      const timeline = runtime.activeCodexTimeline
      if (timeline === undefined) return
      let next = timeline
      let framePermission: ReturnType<typeof codexPermissionPresetFromResponse>
      for (const frame of frames) {
        framePermission = codexPermissionPresetFromResponse(frame.params) ?? framePermission
        next = reduceCodexTimelineFrame(next, frame)
      }
      // Unknown notifications (usage, heartbeats, etc.) do not invalidate the
      // list. Publish an ordered burst once rather than synchronously per delta.
      if (next === timeline && framePermission === undefined) return
      runtime.activeCodexTimeline = next
      const previousItems = new Map(timeline.items.map(item => [item.id, item]))
      const live = codexItemsToChat(next.items.filter(item => previousItems.get(item.id) !== item))
      set(state => {
        const current = state.sessions.find(item => item.sessionId === next.session.id)
          ?? state.selectedSession
        if (current === undefined || current.backend !== 'codex') return {}
        const session = framePermission === undefined
          ? updateCodexSession(current, next.session)
          : withCodexPermission(updateCodexSession(current, next.session), framePermission)
        return {
          sessions: state.sessions.map(item => item.sessionId === session.sessionId ? session : item),
          selectedSession: state.selectedSession?.sessionId === session.sessionId ? session : state.selectedSession,
          ...(live.length === 0 ? {} : { messages: {
            ...state.messages,
            [session.sessionId]: mergeCodexLive(state.messages[session.sessionId] ?? [], live),
          } }),
        }
      })
    },

    handleCursorFrame(frame) {
      const session = get().selectedSession
      if (session === undefined || (session.backend !== 'cursor' && session.backend !== 'antigravity' && session.backend !== 'pi' && session.backend !== 'opencode' && session.backend !== 'claude' && session.backend !== 'hermes')) return
      const params = isRecord(frame.frame.params) ? frame.frame.params : undefined
      if (params?.sessionId !== undefined && params.sessionId !== cursorNativeId(session)) return
      const update = params === undefined
        ? undefined
        : (isRecord(params.update) ? params.update : params)
      let kind: string | undefined
      if (update !== undefined && typeof update.sessionUpdate === 'string') {
        kind = update.sessionUpdate
        const catchUpCount = Array.isArray(update.catchUp) ? update.catchUp.length : 0
        // Diagnostic only: kind + catch-up size, never prompt or tool payloads.
        console.info('[dsh-remote] acp frame:', session.backend, kind, catchUpCount > 0 ? `catchUp=${catchUpCount}` : '')
      }
      set(state => ({
        messages: {
          ...state.messages,
          [session.sessionId]: applyCursorFrame(state.messages[session.sessionId] ?? [], session.sessionId, frame),
        },
        ...(kind === 'prompt_completed' || kind === 'prompt_failed'
          ? {
            sessions: state.sessions.map(item => item.sessionId === session.sessionId ? { ...item, running: false } : item),
            selectedSession: state.selectedSession?.sessionId === session.sessionId
              ? { ...state.selectedSession, running: false }
              : state.selectedSession,
            ...(kind === 'prompt_failed'
              ? { error: session.backend === 'claude' ? zhCN.runtime.claudeUnavailable : session.backend === 'hermes' ? zhCN.runtime.hermesUnavailable : session.backend === 'opencode' ? zhCN.runtime.opencodeUnavailable : session.backend === 'pi' ? zhCN.runtime.piUnavailable : session.backend === 'antigravity' ? zhCN.runtime.antigravityUnavailable : zhCN.runtime.cursorUnavailable }
              : {}),
          }
          : {}),
      }))
      if (session.backend === 'antigravity' && kind === 'prompt_completed') void runtime.refreshAntigravityCatalog()
      if (session.backend === 'pi' && kind === 'prompt_completed') void runtime.refreshPiCatalog()
      if (session.backend === 'opencode' && kind === 'prompt_completed') void runtime.refreshOpencodeCatalog()
      if (session.backend === 'claude' && kind === 'prompt_completed') void runtime.refreshClaudeCatalog()
      if (session.backend === 'hermes' && kind === 'prompt_completed') void runtime.refreshHermesCatalog()
    },
  }
}
