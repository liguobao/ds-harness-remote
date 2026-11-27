import { reduceCodexTimelineFrame } from '@dsh-remote/client-core'
import { friendlyError } from '../lib/errors'
import { strings as zhCN } from '../locales/i18n'
import {
  codexItemsToChat,
  codexPermissionPresetFromResponse,
  mergeCodexLive,
  updateCodexSession,
  withCodexPermission,
} from '../services/codex'
import { isAcpManagedBackend } from '../lib/workspace-key'
import { applyCursorFrame, cursorNativeId, normalizeAcpTodos } from '../services/cursor'
import type { ChatItem, RemoteSession } from '../types'
import { applyMuxFrameToMessages, sessionRunningForMuxFrame, settleOrphanedQueuedItems } from './event-reducer'
import { inboxRpcIds, reconcileUserQuestionsProjection } from './message-helpers'
import type { SessionAccess } from './session-runtime'
import { acpUnavailableMessage } from './acp-backend-helpers'
import { isHarnessPromptStarted, isRecord, record, stringValue } from './session-state'
import type { AppState } from './store-state'

/** SessionEvent actions use the store's single connection/session runtime. */
export function createSessionEventActions({ get, set, runtime }: SessionAccess): Pick<AppState,
  'handleMuxFrame' | 'handleCodexFrame' | 'handleCodexFrames' | 'handleCursorFrame'> {
  return {
    handleMuxFrame(frame) {
      if (frame.payload.type === 'session/catalog-changed') {
        runtime.scheduleHarnessCatalogSync()
        return
      }
      if (frame.payload.type === 'session/status') {
        const { sessionId, running } = frame.payload
        if (typeof sessionId !== 'string' || typeof running !== 'boolean') return
        let missingFromCatalog = false
        set(state => {
          const existing = state.sessions.find(item => item.sessionId === sessionId)
          if (existing === undefined) missingFromCatalog = true
          const entry = state.sessionLifecycles[sessionId]
          const nextLifecycle = {
            seq: entry?.seq ?? -1,
            turn: entry?.turn,
            startedAt: running && entry?.running ? entry.startedAt : undefined,
            running,
            ...(running
              ? { finished: undefined }
              : { finished: entry?.finished === 'failed' ? 'failed' as const : 'completed' as const }),
          }
          const rowChanged = existing !== undefined && existing.running !== running
          const selectedChanged = state.selectedSession?.sessionId === sessionId && state.selectedSession.running !== running
          return {
            sessionLifecycles: { ...state.sessionLifecycles, [sessionId]: nextLifecycle },
            ...(rowChanged ? { sessions: state.sessions.map(item => item.sessionId === sessionId ? { ...item, running } : item) } : {}),
            ...(selectedChanged && state.selectedSession !== undefined ? { selectedSession: { ...state.selectedSession, running } } : {}),
          }
        })
        if (missingFromCatalog) runtime.scheduleHarnessCatalogSync()
        return
      }
      if (frame.payload.type === 'session/activity') {
        const { sessionId, updatedAt } = frame.payload
        if (typeof sessionId !== 'string' || typeof updatedAt !== 'number' || !Number.isFinite(updatedAt)) return
        let missingFromCatalog = false
        set(state => {
          const existing = state.sessions.find(item => item.sessionId === sessionId)
          if (existing === undefined) missingFromCatalog = true
          const rowChanged = existing !== undefined && updatedAt > existing.updatedAt
          const selectedChanged = state.selectedSession?.sessionId === sessionId && updatedAt > state.selectedSession.updatedAt
          if (!rowChanged && !selectedChanged) return {}
          return {
            ...(rowChanged ? { sessions: state.sessions.map(item => item.sessionId === sessionId ? { ...item, updatedAt } : item) } : {}),
            ...(selectedChanged && state.selectedSession !== undefined ? { selectedSession: { ...state.selectedSession, updatedAt } } : {}),
          }
        })
        if (missingFromCatalog) runtime.scheduleHarnessCatalogSync()
        return
      }
      if (frame.payload.type === 'session/error') {
        const { sessionId } = frame.payload
        if (typeof sessionId !== 'string') return
        set(state => {
          const entry = state.sessionLifecycles[sessionId]
          const existing = state.sessions.find(item => item.sessionId === sessionId)
          return {
            sessionLifecycles: {
              ...state.sessionLifecycles,
              [sessionId]: {
                seq: entry?.seq ?? -1,
                turn: entry?.turn,
                running: entry?.running ?? existing?.running ?? false,
                finished: 'failed' as const,
              },
            },
          }
        })
        return
      }
      if (frame.payload.type === 'session/added') {
        const incoming = frame.payload.session
        if (incoming === undefined) return
        let needsWorkspaceSync = false
        set(state => {
          const existing = state.sessions.find(item => item.sessionId === incoming.sessionId)
          const isRoot = incoming.parentSessionId === undefined && incoming.origin !== 'subagent'
          const assigned = state.workspaces.some(w => (w.backend ?? 'harness') === 'harness' && w.sessionIds.includes(incoming.sessionId))
          if (existing === undefined && isRoot && !assigned) needsWorkspaceSync = true
          const merged = existing === undefined
            ? incoming
            : {
                ...existing,
                ...incoming,
                ...(incoming.title === undefined && existing.title !== undefined ? { title: existing.title } : {}),
                ...(incoming.projections === undefined && existing.projections !== undefined ? { projections: existing.projections } : {}),
              }
          return {
            sessions: existing === undefined
              ? [merged, ...state.sessions]
              : state.sessions.map(item => item.sessionId === incoming.sessionId ? merged : item),
            ...(state.selectedSession?.sessionId === incoming.sessionId ? { selectedSession: merged } : {}),
          }
        })
        if (needsWorkspaceSync) runtime.scheduleHarnessCatalogSync()
        return
      }
      if (frame.payload.type === 'session/removed') {
        const { sessionId } = frame.payload
        if (typeof sessionId !== 'string') return
        set(state => {
          const inSessions = state.sessions.some(item => item.sessionId === sessionId)
          const inWorkspaces = state.workspaces.some(w => (w.backend ?? 'harness') === 'harness' && w.sessionIds.includes(sessionId))
          if (!inSessions && !inWorkspaces) return {}
          return {
            ...(inSessions ? { sessions: state.sessions.filter(item => item.sessionId !== sessionId) } : {}),
            ...(inWorkspaces
              ? {
                  workspaces: state.workspaces.map(w => (w.backend ?? 'harness') === 'harness' && w.sessionIds.includes(sessionId)
                    ? { ...w, sessionIds: w.sessionIds.filter(id => id !== sessionId) }
                    : w),
                }
              : {}),
          }
        })
        return
      }
      set(state => {
        const sessionId = frame.payload.sessionId
        if (frame.payload.type === 'session/projection' && sessionId !== undefined && typeof frame.payload.key === 'string') {
          const { key, value, seq } = frame.payload
          const previous = state.sessionProjectionSeqs[sessionId]?.[key]
          if (seq !== undefined && previous !== undefined && seq < previous) return {}
          const update = (session: RemoteSession): RemoteSession => session.sessionId !== sessionId ? session : {
            ...session,
            ...(key === 'title' && typeof value === 'string' && value !== '' ? { title: value } : {}),
            projections: { ...session.projections, values: { ...session.projections?.values, [key]: value } },
          }
          const currentSession = state.sessions.find(item => item.sessionId === sessionId)
            ?? (state.selectedSession?.sessionId === sessionId ? state.selectedSession : undefined)
          const nextValues = {
            ...currentSession?.projections?.values,
            [key]: value,
          }
          // Only local pending rows follow the inbox. A durable user/message
          // echo is stronger evidence than a delayed control-stream projection.
          // Leaving the inbox is the normal claim/execution handoff (idle send,
          // next-turn claim, or steer): return the row to the timeline without
          // flagging a delivery error while awaiting its durable echo. Unadopted
          // idle rows and stop/failure/reload paths still settle lost prompts.
          const settle = key === 'inbox' ? (items: ChatItem[]): ChatItem[] => {
            const queued = inboxRpcIds(value)
            const isIdle = currentSession?.running === false
            const next = items.map(item => {
              if (item.kind !== 'message' || item.role !== 'user' || !item.id.startsWith('local:')
                || item.nativeSeq !== undefined || item.requestRpcId === undefined || item.sendState === 'canceled') return item
              if (queued.has(item.requestRpcId)) {
                return { ...item, sendState: 'queued' as const, queuedAdopted: true, sendError: undefined }
              }
              if (item.queuedAdopted === true && item.sendState === 'queued') {
                return { ...item, sendState: undefined, sendError: undefined }
              }
              if (isIdle && item.sendState === 'queued') {
                return { ...item, sendState: 'unconfirmed' as const, sendError: undefined }
              }
              return item
            })
            return nextValues.userQuestions === undefined
              ? next
              : reconcileUserQuestionsProjection(next, sessionId, nextValues.userQuestions, value)
          } : key === 'userQuestions' ? (items: ChatItem[]): ChatItem[] => (
            reconcileUserQuestionsProjection(items, sessionId, value, nextValues.inbox)
          ) : undefined
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
        const isTurnEnd = running === false && frame.payload.event?.type === 'turn/end'
        const turnReason = isTurnEnd ? frame.payload.event?.data.reason : undefined
        const isStoppedTurn = isTurnEnd && (isRecord(turnReason)
          ? turnReason.kind === 'aborted' || turnReason.kind === 'interrupted'
          : turnReason === 'aborted' || turnReason === 'interrupted')
        const finishedMark = running === undefined ? undefined
          : running ? undefined
            : isRecord(turnReason) && (turnReason.kind === 'failed' || turnReason.kind === 'error') ? 'failed' as const
              : turnReason === undefined ? undefined : 'completed' as const
        const updateRunning = (session: RemoteSession): RemoteSession => (
          sessionId !== undefined && running !== undefined && session.sessionId === sessionId
            ? { ...session, running }
            : session
        )
        let nextMessages = applyMuxFrameToMessages(state.messages, frame)
        if (isTurnEnd && sessionId !== undefined) {
          const currentSession = state.sessions.find(item => item.sessionId === sessionId)
            ?? (state.selectedSession?.sessionId === sessionId ? state.selectedSession : undefined)
          const inboxSnapshot = currentSession?.projections?.values?.inbox
          if (isStoppedTurn || finishedMark === 'failed') {
            const sessionItems = nextMessages[sessionId] ?? []
            const settled = settleOrphanedQueuedItems(
              sessionItems,
              inboxSnapshot === undefined ? undefined : inboxRpcIds(inboxSnapshot),
            )
            if (settled !== sessionItems) {
              nextMessages = { ...nextMessages, [sessionId]: settled }
            }
          }
        }
        return {
          messages: nextMessages,
          ...(sessionId === undefined || running === undefined ? {} : {
            sessions: state.sessions.map(updateRunning),
            selectedSession: state.selectedSession === undefined ? undefined : updateRunning(state.selectedSession),
            ...(seq === undefined ? {} : {
              sessionLifecycles: {
                ...state.sessionLifecycles,
                [sessionId]: {
                  seq,
                  running,
                  ...(running && frame.payload.event?.time ? { startedAt: frame.payload.event.time } : {}),
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
        if (frame.method === 'turn/completed') {
          const turnId = stringValue(record(record(frame.params).turn).id)
          if (turnId !== undefined) runtime.markCodexTurnCompleted(next.session.nativeId, turnId)
        } else if (frame.method === 'thread/status/changed') {
          const status = record(record(frame.params).status)
          if ((status.type === 'idle' || status.type === 'systemError') && next.activeTurnId !== undefined) {
            runtime.markCodexTurnCompleted(next.session.nativeId, next.activeTurnId)
          }
        }
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
      if (session === undefined || !isAcpManagedBackend(session.backend)) return
      const params = isRecord(frame.frame.params) ? frame.frame.params : undefined
      if (params?.sessionId !== undefined && params.sessionId !== cursorNativeId(session)) return
      const update = params === undefined
        ? undefined
        : (isRecord(params.update) ? params.update : params)
      let kind: string | undefined
      if (frame.frame.method === 'cursor/update_todos') {
        kind = 'cursor/update_todos'
      } else if (update !== undefined && typeof update.sessionUpdate === 'string') {
        kind = update.sessionUpdate
        const catchUpCount = Array.isArray(update.catchUp) ? update.catchUp.length : 0
        // Diagnostic only: kind + catch-up size, never prompt or tool payloads.
        console.info('[dsh-remote] acp frame:', session.backend, kind, catchUpCount > 0 ? `catchUp=${catchUpCount}` : '')
      }
      runtime.acpFrameRevision++
      if (kind === 'prompt_completed' || kind === 'prompt_failed') {
        runtime.acpTerminalRevisions.set(session.sessionId, (runtime.acpTerminalRevisions.get(session.sessionId) ?? 0) + 1)
      }
      const nextTodos = kind === 'cursor/update_todos' || kind === 'plan'
        ? normalizeAcpTodos((update ?? params)?.todos ?? (update ?? params)?.entries ?? (update ?? params)?.items)
        : undefined
      const nextMode = kind === 'current_mode_update' && update !== undefined
        ? (typeof update.currentModeId === 'string' ? update.currentModeId
          : typeof update.modeId === 'string' ? update.modeId
          : typeof update.mode === 'string' ? update.mode : undefined)
        : undefined
      const nextCommands = kind === 'available_commands_update' && update !== undefined && Array.isArray(update.availableCommands)
        ? update.availableCommands.flatMap(entry => isRecord(entry) && typeof entry.name === 'string' && entry.name.trim()
          ? [{
              name: entry.name.trim(),
              ...(typeof entry.description === 'string' ? { description: entry.description } : {}),
              ...(isRecord(entry.input) && typeof entry.input.hint === 'string' ? { input: { hint: entry.input.hint } } : {}),
            }]
          : [])
        : undefined
      const nextContextPressure = kind === 'usage_update' && update !== undefined
        && typeof update.used === 'number' && typeof update.size === 'number'
        ? { used: update.used, size: update.size, ratio: update.size > 0 ? Math.min(1, Math.max(0, update.used / update.size)) : 0 }
        : undefined
      const isTurnTerminalFrame = kind === 'prompt_completed' || kind === 'prompt_failed'
      const isTurnActiveFrame = !isTurnTerminalFrame && (
        kind === 'agent_message_chunk'
        || kind === 'agent_message'
        || kind === 'agent_thought_chunk'
        || kind === 'agent_thought'
        || kind === 'tool_call'
        || kind === 'tool_call_update'
        || kind === 'user_message_chunk'
      )
      const markOpencodePending = session.backend === 'opencode' && kind === 'prompt_completed'
      const applySessionMetadata = (item: RemoteSession): RemoteSession => {
        if (item.sessionId !== session.sessionId) return item
        const nextValues = {
          ...item.projections?.values,
          ...(nextTodos !== undefined ? { todos: nextTodos } : {}),
          ...(nextContextPressure !== undefined ? { contextPressure: nextContextPressure } : {}),
          ...(markOpencodePending ? { pendingCatalog: true } : {}),
        }
        return {
          ...item,
          ...(isTurnTerminalFrame ? { running: false } : isTurnActiveFrame ? { running: true } : {}),
          ...(nextMode !== undefined ? { agentPreset: nextMode } : {}),
          ...(nextCommands !== undefined ? { availableCommands: nextCommands } : {}),
          ...((nextTodos !== undefined || nextContextPressure !== undefined || markOpencodePending)
            ? { projections: { ...item.projections, values: nextValues } }
            : {}),
        }
      }
      const needsRunningRestore = isTurnActiveFrame
        && (!session.running || get().sessions.some(item => item.sessionId === session.sessionId && !item.running))
      const sessionMetaChanged = isTurnTerminalFrame || needsRunningRestore || markOpencodePending
        || nextTodos !== undefined || nextMode !== undefined || nextCommands !== undefined || nextContextPressure !== undefined
      set(state => ({
        messages: {
          ...state.messages,
          [session.sessionId]: applyCursorFrame(state.messages[session.sessionId] ?? [], session.sessionId, frame),
        },
        ...(sessionMetaChanged
          ? {
            sessions: state.sessions.map(applySessionMetadata),
            selectedSession: state.selectedSession === undefined ? undefined : applySessionMetadata(state.selectedSession),
            ...(kind === 'prompt_failed'
              ? { error: acpPromptFailureMessage(session.backend, update) }
              : {}),
          }
          : {}),
      }))
      if (kind === 'prompt_completed') {
        if (session.backend === 'antigravity') void runtime.refreshAntigravityCatalog()
        else if (session.backend === 'pi') void runtime.refreshPiCatalog()
        else if (session.backend === 'opencode') void runtime.refreshOpencodeCatalog()
        else if (session.backend === 'claude') void runtime.refreshClaudeCatalog()
        else if (session.backend === 'hermes') void runtime.refreshHermesCatalog()
        else if (session.backend === 'kimi') void runtime.refreshKimiCatalog()
        else if (session.backend === 'cursor') void runtime.refreshCursorCatalog()
        else if (session.backend) void runtime.refreshCustomAcpCatalog(session.backend)
      }
    },
  }
}

function acpPromptFailureMessage(
  backend: RemoteSession['backend'],
  update: Record<string, unknown> | undefined,
): string {
  const fallback = acpUnavailableMessage(backend)
  const code = typeof update?.code === 'string' && update.code.trim().length > 0 ? update.code.trim() : undefined
  const message = typeof update?.message === 'string' && update.message.trim().length > 0 ? update.message.trim() : undefined
  if (code === undefined && message === undefined) return fallback
  const err = Object.assign(new Error(message ?? fallback), code === undefined ? {} : { code })
  const resolved = friendlyError(err)
  if (code !== undefined && resolved === fallback && message === undefined && code !== 'CURSOR_UNAVAILABLE') {
    return `${fallback} (${code})`
  }
  return resolved
}
