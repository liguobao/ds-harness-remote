import * as Haptics from 'expo-haptics'
import { friendlyError, isApprovalNotFoundError, isQueueItemNotFoundError, isRecoverableTransportError, isRpcTimeoutError } from '../lib/errors'
import { parseHandoffMessage } from '../lib/handoff-context'
import { firstLineSnippet, harnessDisplayName, isHandoffRawText, sanitizeHandoffDisplayTitle } from '../lib/handoff-preview'
import { strings as zhCN } from '../locales/i18n'
import { browseScope, recordHandoffOrigin } from '../services/browse-memory'
import { createNativeRpcId } from '../services/rpc-id'
import {
  codexPermissionPresetFromResponse,
  codexThreadId,
  readCodexHistoryPage,
} from '../services/codex'
import { cursorNativeId } from '../services/cursor'
import { isAcpManagedBackend } from '../lib/workspace-key'
import { resolveHarnessSendMode } from '../screens/chat/composer-gate'
import type { ChatItem, RemoteSession } from '../types'
import { acpClientForBackend } from './acp-backend-helpers'
import { withCodexPermissionState } from './codex-session-state'
import { findQuestion, inboxQueuedItems, inboxRpcIds, mapApprovalOutcome, mapQuestionAnswered, removeInboxQueueItem } from './message-helpers'
import type { SessionAccess } from './session-runtime'
import { isRecord, record, stringValue, withActiveCodexTurn } from './session-state'
import type { AppState } from './store-state'

/** Prompt actions use the store's single connection/session runtime. */
export function createPromptActions({ get, set, runtime }: SessionAccess): Pick<AppState,
  'sendMessage' | 'updateQueueItem' | 'retrySendMessage' | 'stopSession' | 'cancelCompaction' | 'respondApproval' | 'respondQuestion'> {
  return {
    async sendMessage(input, images = [], reuseRpcId, files = []) {
      if (get().busyAction?.startsWith('session:')) return 'rejected'
      runtime.flushPendingMuxFrames()
      set({ commandResult: undefined })
      const session = get().selectedSession
      const text = input.trim()
      if (session === undefined || (text.length === 0 && images.length === 0 && files.length === 0)) return 'rejected'
      // Fail closed before the optimistic row is inserted. Without this guard an
      // offline prompt becomes a `local:` row marked failed/unconfirmed and the
      // call returns 'kept', which forbids the caller from restoring the draft.
      if (get().connection.phase !== 'connected' || get().acpReadOnlySessionId === session.sessionId) return 'rejected'
      if (session.backend === 'codex' && (get().codexReadySessionId !== session.sessionId
        || runtime.activeCodexStream === undefined
        || runtime.activeCodexTimeline?.session.nativeId !== codexThreadId(session))) return 'rejected'
      // `/compact` can legitimately outlive every RPC deadline. When the Host
      // advertises the async contract, submit a tracked operation and observe
      // it: a disconnect leaves it running and the next connection resumes the
      // saved operation instead of starting a second compaction.
      if ((session.backend === undefined || session.backend === 'harness') && /^\/compact(?:\s|$)/u.test(text)) {
        const proxy = runtime.connection.requireProxy()
        if (proxy.supportsAsyncCompaction) {
          set({ busyAction: 'command', error: undefined })
          try {
          if (images.length > 0) throw new Error(zhCN.messageActions.unavailable)
          const outcome = await proxy.compactSessionTracked(session.sessionId)
          if (outcome.kind === 'unconfirmed') {
            set({
              busyAction: undefined,
              commandResult: { sessionId: session.sessionId, text: outcome.message },
            })
            return 'sent'
          }
          const status = outcome.status
          set({ busyAction: undefined })
          if (status.state !== 'succeeded') throw new Error(status.message ?? zhCN.messageActions.failed)
          set({
            commandResult: status.message?.trim()
              ? { sessionId: session.sessionId, text: status.message } : undefined,
          })
          return 'sent'
          } catch (error) {
            set({ busyAction: undefined, error: friendlyError(error) })
            return 'rejected'
          }
        }
      }
      if ((session.backend === undefined || session.backend === 'harness') && /^\/(?:file|goal|plan|feedback|compact|export)(?:\s|$)/u.test(text)) {
        set({ busyAction: 'command', error: undefined })
        try {
          // Commands are not prompts: never fabricate an optimistic user turn.
          if (images.length > 0) throw new Error(zhCN.messageActions.unavailable)
          const result = await runtime.connection.requireProxy().sessionExecuteCommand(session.sessionId, text)
          if (result.kind === 'error') throw new Error(result.text ?? zhCN.messageActions.failed)
          set({
            busyAction: undefined, commandResult: result.text?.trim()
              ? { sessionId: session.sessionId, text: result.text } : undefined
          })
          return 'sent'
        } catch (error) {
          set({ busyAction: undefined, error: friendlyError(error) })
          return 'rejected'
        }
      }
      const parsedHandoff = parseHandoffMessage(text)
      if (parsedHandoff !== undefined) {
        const fallbackTitle = firstLineSnippet(parsedHandoff.instruction, 80)
        recordHandoffOrigin(browseScope(get()), session.sessionId, {
          sourceBackend: parsedHandoff.meta.sourceBackend,
          targetBackend: parsedHandoff.meta.targetBackend,
          sourceSessionId: parsedHandoff.meta.sourceSessionId,
          ...(parsedHandoff.meta.sourceTitle !== undefined ? { sourceTitle: parsedHandoff.meta.sourceTitle } : {}),
          ...(fallbackTitle !== undefined ? { fallbackTitle } : {}),
          preset: parsedHandoff.meta.preset,
          createdAt: parsedHandoff.meta.createdAt,
        })
      }
      const optimisticAcpTitle = parsedHandoff !== undefined
        ? (parsedHandoff.meta.sourceTitle?.trim()
          || firstLineSnippet(parsedHandoff.instruction, 60)
          || `${harnessDisplayName(parsedHandoff.meta.sourceBackend)} → ${harnessDisplayName(parsedHandoff.meta.targetBackend)}`)
        : isHandoffRawText(text)
          ? (sanitizeHandoffDisplayTitle(text, zhCN.handoff.title) ?? zhCN.handoff.title)
          : (text.slice(0, 60) || zhCN.chat.unnamedImage)
      const requestRpcId = reuseRpcId ?? createNativeRpcId()
      // DSH semantics (`ui-conversation.busyEnter`): while a turn is active,
      // prompts default to `'queue'` unless the user selected `'steer'`.
      const runningAtSend = session.running === true || get().busyAction === 'send-message'
      const harnessSendMode = resolveHarnessSendMode({
        running: runningAtSend,
        preferredMode: get().busySendMode,
      })
      const expectQueued = runningAtSend && harnessSendMode === 'queue'
      const previousMessages = get().messages[session.sessionId] ?? []
      const previousAcpUser = isAcpManagedBackend(session.backend)
        ? previousMessages.findLast(item => item.kind === 'message' && item.role === 'user')
        : undefined
      const emptyAcpHistory = runtime.emptyAcpHistory
      const startedWithoutHistory = previousMessages.length === 0 && emptyAcpHistory?.sessionId === session.sessionId
        && emptyAcpHistory.loadGeneration === runtime.sessionLoadGeneration
        && emptyAcpHistory.connectionGeneration === runtime.connectionGeneration
      const acpPromptAfter = previousAcpUser?.nativeSeq !== undefined ? previousAcpUser.id
        : startedWithoutHistory ? null : undefined
      const optimistic: ChatItem = {
        kind: 'message',
        // `local:` prefix is load-bearing for mergeCodexLive's optimistic matching;
        // the rpcId suffix keeps the id unique when several prompts are queued in
        // the same millisecond (duplicate keys corrupt the merged timeline).
        id: `local:${requestRpcId}`,
        sessionId: session.sessionId,
        role: 'user',
        text,
        ...(images.length === 0 ? {} : { images: images.map(image => ({ uri: image.uri, name: image.name })) }),
        ...(files.length === 0 ? {} : { files }),
        createdAt: Date.now(),
        requestRpcId,
        // Retry material travels with the row (not a module map) so image rows
        // stay resendable across reconnects and cannot leak after cleanup.
        promptImages: images,
        ...(!runningAtSend && (session.backend === undefined || session.backend === 'harness')
          ? { submittedWhileIdle: true } : {}),
      }
      set(state => ({
        messages: {
          ...state.messages, [session.sessionId]: [
            ...(state.messages[session.sessionId] ?? []).filter(item => item.id !== optimistic.id),
            optimistic,
          ]
        },
        busyAction: 'send-message',
        error: undefined,
      }))
      try {
        if (session.backend === 'codex') {
          const client = runtime.connection.requireCodex()
          const threadId = codexThreadId(session)
          const loadGeneration = runtime.sessionLoadGeneration
          const connGeneration = runtime.connectionGeneration
          const isCurrentTarget = () => loadGeneration === runtime.sessionLoadGeneration
            && connGeneration === runtime.connectionGeneration
            && get().selectedSession?.sessionId === session.sessionId
          const promptInput = [
            ...(text.length === 0 ? [] : [{ type: 'text', text }]),
            ...images.map(image => ({ type: 'image', mediaType: image.mediaType, data: image.data })),
          ]
          const activeTurnId = runtime.activeCodexTimeline?.session.nativeId === threadId
            ? runtime.activeCodexTimeline.activeTurnId
            : undefined
          if (activeTurnId !== undefined) {
            await client.request('turn/steer', { threadId, expectedTurnId: activeTurnId, input: promptInput })
          } else {
            const selection = get().sessionModels?.current
            // Continuing a thread inherits its current Host policy. Permission
            // overrides belong to selectPermission, where the user changes it.
            const resumeResult = await client.request('thread/resume', {
              threadId,
              ...(selection?.provider === 'codex' ? { model: selection.model } : {}),
            })
            if (!isCurrentTarget()) {
              set(state => ({
                messages: {
                  ...state.messages,
                  [session.sessionId]: (state.messages[session.sessionId] ?? []).map(item =>
                    item.id === optimistic.id && item.kind === 'message'
                      ? { ...item, sendState: 'failed' as const }
                      : item),
                },
                ...(state.busyAction === 'send-message' ? { busyAction: undefined } : {}),
              }))
              return 'rejected'
            }
            const serverPreset = codexPermissionPresetFromResponse(resumeResult)
            if (serverPreset !== undefined) {
              set(state => withCodexPermissionState(state, session.sessionId, serverPreset))
            }
            const result = record(await client.request('turn/start', {
              threadId,
              input: promptInput,
              ...(selection?.provider === 'codex' ? {
                model: selection.model,
                ...(selection.reasoningEffort === undefined ? {} : { effort: selection.reasoningEffort }),
              } : {}),
            }))
            runtime.flushPendingCodexFrames()
            if (!isCurrentTarget()) {
              set(state => state.busyAction === 'send-message' ? { busyAction: undefined } : {})
              return 'sent'
            }
            const turnId = stringValue(record(result.turn).id)
            const alreadyCompleted = turnId !== undefined && runtime.isCodexTurnCompleted(threadId, turnId)
            if (!alreadyCompleted) {
              if (runtime.activeCodexTimeline?.session.nativeId === threadId) {
                runtime.activeCodexTimeline = {
                  ...runtime.activeCodexTimeline,
                  ...(turnId === undefined ? {} : { activeTurnId: turnId }),
                  session: { ...runtime.activeCodexTimeline.session, status: 'running' },
                }
              }
              set(state => ({
                sessions: state.sessions.map(item => item.sessionId === session.sessionId ? { ...item, running: true } : item),
                selectedSession: state.selectedSession?.sessionId === session.sessionId
                  ? { ...state.selectedSession, running: true }
                  : state.selectedSession,
              }))
            }
          }
        } else if (isAcpManagedBackend(session.backend)) {
          if (session.backend === 'cursor' && images.length > 0) throw new Error(zhCN.runtime.cursorTextOnly)
          if (session.backend === 'pi' && images.length > 0) throw new Error(zhCN.runtime.piTextOnly)
          // Always re-bind the ACP stream on the current RemoteClientCore before
          // prompting. After WebRTC flaps / Metro reload the module-level handle
          // can point at a dead core while RPC still works on a new one.
          const streamGeneration = runtime.sessionLoadGeneration
          await runtime.ensureCursorStream(session, () => streamGeneration === runtime.sessionLoadGeneration
            && get().selectedSession?.sessionId === session.sessionId)
          set(state => ({
            sessions: state.sessions.map(item => item.sessionId === session.sessionId ? { ...item, running: true, blank: false, title: item.blank ? optimisticAcpTitle : item.title } : item),
            selectedSession: state.selectedSession?.sessionId === session.sessionId
              ? { ...state.selectedSession, running: true, blank: false, title: state.selectedSession.blank ? optimisticAcpTitle : state.selectedSession.title }
              : state.selectedSession,
          }))
          // Host may return immediately with stopReason=in_progress so frames can
          // interleave; keep running until prompt_completed / failure.
          const acpClient = acpClientForBackend(runtime.connection, session.backend)
          const promptResult = await acpClient.prompt(cursorNativeId(session), text, undefined, images.map(image => ({
            type: 'image' as const, mimeType: image.mediaType, data: image.data,
          })), session.backend)
          const inProgress = isRecord(promptResult)
            && promptResult.accepted === true
            && promptResult.stopReason === 'in_progress'
          if (inProgress && acpPromptAfter !== undefined) {
            set(state => ({
              messages: {
                ...state.messages,
                [session.sessionId]: (state.messages[session.sessionId] ?? []).map(item =>
                  item.kind === 'message' && item.id === optimistic.id ? { ...item, acpPromptAfter } : item),
              },
            }))
          } else if (!inProgress) {
            set(state => ({
              sessions: state.sessions.map(item => item.sessionId === session.sessionId ? { ...item, running: false } : item),
              selectedSession: state.selectedSession?.sessionId === session.sessionId
                ? { ...state.selectedSession, running: false }
                : state.selectedSession,
            }))
          }
        } else {
          await runtime.connection.requireProxy().sessionPrompt(session.sessionId, text, requestRpcId, images, [], harnessSendMode)
          // `session.prompt` acknowledges receipt only; keep busyAction until the
          // event stream shows the turn starting. When a turn was already active
          // and `mode === 'queue'`, the Host queued the prompt (`inbox`
          // projection is authoritative), so the row leaves the timeline and
          // appears in the queue dock. When `mode === 'steer'`, do not fall back
          // to `'queued'`: the message stays in the timeline awaiting its echo.
          set(state => {
            const latest = state.selectedSession?.sessionId === session.sessionId
              ? state.selectedSession : state.sessions.find(item => item.sessionId === session.sessionId)
            const inInbox = inboxRpcIds(latest?.projections?.values?.inbox).has(requestRpcId)
            const sessionMessages = state.messages[session.sessionId] ?? []
            const echoed = sessionMessages.some(item =>
              item.kind === 'message' && !item.id.startsWith('local:') && item.requestRpcId === requestRpcId)
            // Only idle prompts wait for `turn/start` to release `busyAction`;
            // already-running turns (or adopted/echoed/switched sessions) release on ACK.
            const releaseBusy = state.busyAction === 'send-message' && (
              latest?.running === true
              || inInbox
              || echoed
              || (expectQueued && latest?.running === false)
              || state.selectedSession?.sessionId !== session.sessionId
            )
            return {
              ...(releaseBusy ? { busyAction: undefined } : {}),
              messages: {
                ...state.messages,
                [session.sessionId]: sessionMessages.map(item =>
                  item.id === optimistic.id && item.kind === 'message' && item.sendState !== 'canceled'
                    ? {
                      ...item,
                      // A projection may already have queued or released this
                      // row while the acknowledgement was still in flight.
                      sendState: item.queuedAdopted === true ? item.sendState
                        : inInbox ? 'queued'
                          : item.sendState ?? (expectQueued ? (latest?.running === false ? 'unconfirmed' : 'queued') : undefined),
                      ...(inInbox ? { queuedAdopted: true as const } : {}),
                    }
                    : item),
              },
            }
          })
          await Haptics.impactAsync(
            harnessSendMode === 'steer' && runningAtSend
              ? Haptics.ImpactFeedbackStyle.Medium
              : Haptics.ImpactFeedbackStyle.Light,
          )
          return 'sent'
        }
        set(state => state.busyAction === 'send-message' ? { busyAction: undefined } : {})
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
        return 'sent'
      } catch (error) {
        // Keep the row as the single error surface (inline state + retry). A
        // deleted row plus a Host that already accepted the prompt is exactly the
        // "message vanished / reappears after reload" mismatch; timeout/transport
        // errors leave the outcome unknown and must never be judged by timers.
        const unconfirmed = isRpcTimeoutError(error) || isRecoverableTransportError(error)
        set(state => ({
          messages: {
            ...state.messages,
            [session.sessionId]: (state.messages[session.sessionId] ?? []).map(item =>
              item.id === optimistic.id && item.kind === 'message'
                && item.queuedAdopted !== true && item.sendState !== 'canceled'
                ? { ...item, sendState: unconfirmed ? 'unconfirmed' : 'failed', sendError: friendlyError(error) }
                : item),
          },
          // Only a deterministic failure may claim the agent is idle again; an
          // unconfirmed outcome leaves `running` untouched (the prompt may have
          // started on the Host).
          ...(isAcpManagedBackend(session.backend) && !unconfirmed ? {
            sessions: state.sessions.map(item => item.sessionId === session.sessionId ? { ...item, running: session.running ?? false } : item),
            selectedSession: state.selectedSession?.sessionId === session.sessionId ? { ...state.selectedSession, running: session.running ?? false } : state.selectedSession,
          } : {}),
          ...(state.busyAction === 'send-message' ? { busyAction: undefined } : {}),
        }))
        return 'kept'
      }
    },

    async updateQueueItem(itemId, action, rpcId) {
      runtime.flushPendingMuxFrames()
      const session = get().selectedSession
      // Harness rows may carry `backend: undefined`; only the explicit non-harness
      // backends lack queue actions. The previous strict `'harness'` check silently
      // short-circuited every plain harness session — the queue buttons did
      // nothing with no error.
      if (session === undefined || (session.backend !== undefined && session.backend !== 'harness')
        || get().connection.phase !== 'connected') return false
      const generation = runtime.connectionGeneration
      let notFound = false
      try {
        await runtime.connection.requireProxy().sessionUpdateQueue(session.sessionId, itemId, { kind: action })
      } catch (error) {
        if (generation !== runtime.connectionGeneration) return false
        if (!isQueueItemNotFoundError(error)) {
          set({ error: friendlyError(error) })
          return false
        }
        notFound = true
      }
      if (generation !== runtime.connectionGeneration) return false
      // Settle the matching local optimistic row together with the Host queue:
      // the dock lists local `queued` rows the inbox has not adopted, so without
      // this the steered/removed item is immediately re-listed from local state
      // and the buttons look like no-ops. A confirmed steer hands the row back
      // to the timeline awaiting its echo (only a missing queue entry is
      // unconfirmed); remove retires it quietly and prunes the stale inbox entry.
      set(state => {
        const currentSession = state.selectedSession?.sessionId === session.sessionId
          ? state.selectedSession
          : state.sessions.find(item => item.sessionId === session.sessionId)
        const currentInbox = currentSession?.projections?.values?.inbox
        const effectiveRpcId = rpcId ?? inboxQueuedItems(currentInbox).find(item => item.id === itemId)?.rpcId
        const prunedInbox = removeInboxQueueItem(currentInbox, itemId, effectiveRpcId)
        const inboxChanged = prunedInbox !== currentInbox
        const updateSession = (item: RemoteSession): RemoteSession => item.sessionId !== session.sessionId ? item : {
          ...item,
          projections: {
            ...item.projections,
            values: {
              ...item.projections?.values,
              inbox: prunedInbox,
            },
          },
        }
        const nextSendState = action === 'remove'
          ? 'canceled' as const
          : notFound ? 'unconfirmed' as const : undefined
        const existingMessages = state.messages[session.sessionId] ?? []
        let messagesChanged = false
        const nextMessages = effectiveRpcId === undefined ? existingMessages : existingMessages.map(item => {
          if (item.kind === 'message' && item.requestRpcId === effectiveRpcId && item.id.startsWith('local:')
            && item.nativeSeq === undefined && item.sendState !== 'failed' && item.sendState !== 'canceled') {
            messagesChanged = true
            return { ...item, queuedAdopted: true, sendState: nextSendState, sendError: undefined }
          }
          return item
        })
        if (!inboxChanged && !messagesChanged) return {}
        return {
          ...(inboxChanged ? {
            sessions: state.sessions.map(updateSession),
            selectedSession: state.selectedSession === undefined ? undefined : updateSession(state.selectedSession),
          } : {}),
          ...(messagesChanged ? {
            messages: {
              ...state.messages,
              [session.sessionId]: nextMessages,
            },
          } : {}),
        }
      })
      return true
    },

    async retrySendMessage(itemId) {
      runtime.flushPendingMuxFrames()
      const state = get()
      if (state.busyAction !== undefined) return false
      const session = state.selectedSession
      if (session === undefined) return false
      const row = (state.messages[session.sessionId] ?? []).find(item => item.id === itemId)
      if (row?.kind !== 'message' || (row.sendState !== 'failed' && row.sendState !== 'unconfirmed') || row.requestRpcId === undefined) return false
      // Reuse the original request rpcId: a prompt the Host already accepted
      // (unconfirmed outcome) must not be executed twice where the Host dedupes.
      return (await get().sendMessage(row.text, row.promptImages ?? [], row.requestRpcId, row.files)) === 'sent'
    },

    async cancelCompaction() {
      const session = get().selectedSession
      if (session === undefined) return false
      try {
        const proxy = runtime.connection.requireProxy()
        if (!proxy.supportsAsyncCompaction) return false
        const status = await proxy.cancelTrackedCompaction(session.sessionId)
        if (status === undefined) return false
        set({
          commandResult: {
            sessionId: session.sessionId,
            text: status.message?.trim()
              || (status.state === 'cancelled' ? 'Compaction cancelled.' : `Compaction ${status.state}.`),
          },
        })
        return true
      } catch (error) {
        set({ error: friendlyError(error) })
        return false
      }
    },

    async stopSession() {
      const session = get().selectedSession
      if (session === undefined || get().acpReadOnlySessionId === session.sessionId) return
      set({ busyAction: 'stop-session' })
      try {
        if (session.backend === 'codex') {
          const threadId = codexThreadId(session)
          const client = runtime.connection.requireCodex()
          let turnId = runtime.activeCodexTimeline?.session.nativeId === threadId
            ? runtime.activeCodexTimeline.activeTurnId
            : undefined
          if (turnId === undefined) {
            const history = await readCodexHistoryPage(client, threadId, undefined, 1)
            turnId = history.activeTurnId
            if (turnId !== undefined && runtime.activeCodexTimeline?.session.nativeId === threadId) {
              runtime.activeCodexTimeline = withActiveCodexTurn(runtime.activeCodexTimeline, turnId)
            }
          }
          if (turnId === undefined) throw new Error(zhCN.runtime.codexTurnUnavailable)
          await client.interrupt(threadId, turnId)
        } else if (isAcpManagedBackend(session.backend)) {
          const acpClient = acpClientForBackend(runtime.connection, session.backend)
          await acpClient.cancel(cursorNativeId(session))
          set(state => ({
            sessions: state.sessions.map(item => item.sessionId === session.sessionId ? { ...item, running: false } : item),
            selectedSession: state.selectedSession?.sessionId === session.sessionId
              ? { ...state.selectedSession, running: false }
              : state.selectedSession,
          }))
        } else {
          await runtime.connection.requireProxy().sessionCancel(session.sessionId)
        }
      } catch (error) {
        set({ error: friendlyError(error) })
      } finally {
        set({ busyAction: undefined })
      }
    },

    async respondApproval(itemId, outcome, sessionId) {
      runtime.flushPendingMuxFrames()
      set({ busyAction: `approval:${itemId}`, error: undefined })
      const item = get().messages[sessionId]?.find(value => value.kind === 'approval' && value.id === itemId)
      try {
        if (item?.kind !== 'approval') {
          throw new Error(zhCN.runtime.openSessionFirst)
        }
        const session = get().sessions.find(value => value.sessionId === item.sessionId) ?? get().selectedSession
        if (session?.backend === 'codex') {
          await runtime.connection.requireCodex().respond(item.approvalId, outcome === 'allowed-once' ? 'accept' : 'decline')
        } else if (isAcpManagedBackend(session?.backend)) {
          const acpClient = acpClientForBackend(runtime.connection, session.backend)
          await acpClient.respond(
            item.approvalId,
            outcome === 'allowed-once' ? 'allow-once' : 'reject-once',
          )
        } else {
          if (item.frameRpcId === undefined) throw new Error(zhCN.runtime.openSessionFirst)
          await runtime.connection.requireProxy().respondApproval(item.frameRpcId, item.sessionId, item.approvalId, outcome)
        }
        set(state => ({
          messages: mapApprovalOutcome(state.messages, item.sessionId, itemId, outcome),
          busyAction: undefined,
        }))
        await Haptics.notificationAsync(outcome === 'rejected'
          ? Haptics.NotificationFeedbackType.Warning
          : Haptics.NotificationFeedbackType.Success)
      } catch (error) {
        if (isApprovalNotFoundError(error)) {
          set(state => {
            const messages = mapApprovalOutcome(state.messages, sessionId, itemId, 'unavailable')
            return { messages, busyAction: undefined, error: messages === state.messages ? state.error : friendlyError(error) }
          })
          return
        }
        set({ busyAction: undefined, error: friendlyError(error) })
      }
    },

    async respondQuestion(itemId, selected, custom) {
      runtime.flushPendingMuxFrames()
      set({ busyAction: `question:${itemId}`, error: undefined })
      try {
        const item = findQuestion(get().messages, itemId)
        if (item === undefined || item.frameRpcId === undefined) {
          throw new Error(zhCN.runtime.openSessionFirst)
        }
        const answers = item.questions.map(question => {
          const freeText = custom?.[question.id]?.trim()
          return {
            id: question.id,
            selected: selected[question.id] ?? [],
            // Official answer shape carries `custom`; keep it out when empty.
            ...(freeText === undefined || freeText.length === 0 ? {} : { custom: freeText }),
          }
        })
        const session = get().sessions.find(value => value.sessionId === item.sessionId) ?? get().selectedSession
        if (isAcpManagedBackend(session?.backend)) {
          const acpClient = acpClientForBackend(runtime.connection, session.backend)
          await acpClient.respond(item.frameRpcId, 'allow-once', { answers })
          set(state => ({
            messages: mapQuestionAnswered(state.messages, itemId),
            busyAction: undefined,
          }))
        } else {
          const proxy = runtime.connection.requireProxy()
          await proxy.respondQuestion(item.frameRpcId, item.sessionId, { answers })
          set(state => ({
            messages: item.callId === undefined ? mapQuestionAnswered(state.messages, itemId) : state.messages,
            busyAction: undefined,
          }))
        }
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      } catch (error) {
        set({ busyAction: undefined, error: friendlyError(error) })
      }
    },
  }
}
