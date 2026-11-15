/**
 * Composer availability rules for the chat input.
 *
 * Editing is a local operation: a dropped carrier must never lock the
 * `TextInput`, otherwise the draft cannot be continued while the Host is
 * unreachable. Sending still requires the authenticated channel, so an offline
 * tap must leave the draft untouched instead of entering the submit path that
 * clears it before `sendMessage` runs.
 */

/** Reason a send attempt must not start. */
export type SubmitIntent = 'submit' | 'offline' | 'ignore'

export type SubmitGateInput = {
  /** Authenticated Host channel (Harness/ACP/CodeX ready). */
  connected: boolean
  /** Connection plus per-backend readiness and no blocking session action. */
  sendReady: boolean
  permissionSelecting: boolean
  /** A prompt upload is already in flight. */
  uploading: boolean
  /** Live draft/quotes/images/files produced by the caller, not the render closure. */
  hasContent: boolean
}

export type ComposerEditGateInput = {
  permissionSelecting: boolean
  uploading: boolean
}

/**
 * Editing stays available while the Host is unreachable; only composer-local
 * blocking states (permission switch, in-flight upload) lock the input.
 */
export function composerEditable(input: ComposerEditGateInput): boolean {
  return !input.permissionSelecting && !input.uploading
}

/**
 * `offline` means the tap was deliberate but cannot be delivered: the caller
 * must return before clearing the draft or creating an optimistic row.
 */
export function submitIntent(input: SubmitGateInput): SubmitIntent {
  if (input.uploading || !input.hasContent) return 'ignore'
  if (!input.connected) return 'offline'
  if (!input.sendReady || input.permissionSelecting) return 'ignore'
  return 'submit'
}

/**
 * Blank sessions retain the data-policy note when vertical space allows,
 * while active chats keep the bottom bar compact without extra footer lines.
 */
export function policyHintVisible(input: { showPolicyHint: boolean; compactComposer: boolean }): boolean {
  return input.showPolicyHint && !input.compactComposer
}

export type QuickPromptActionMode = 'fill' | 'send'

export function isQuickPromptActionMode(value: unknown): value is QuickPromptActionMode {
  return value === 'fill' || value === 'send'
}

/**
 * Show the top-right corner expand trigger only once a draft spans multiple lines
 * so single-line typing never squeezes the input width on the first character.
 */
export function shouldShowExpandCorner(input: { draft: string; contentHeight: number }): boolean {
  return input.draft.includes('\n') || input.contentHeight > 44
}

/**
 * Insert a quick prompt into an existing or empty draft and place the caret at the end.
 */
export function applyQuickPromptDraft(
  currentDraft: string,
  promptText: string,
): { draft: string; cursor: number } {
  if (promptText.length === 0) {
    return { draft: currentDraft, cursor: currentDraft.length }
  }
  const separator =
    currentDraft.length === 0 || currentDraft.endsWith('\n') || currentDraft.endsWith(' ')
      ? ''
      : (currentDraft.includes('\n') || promptText.includes('\n') ? '\n' : ' ')
  const draft = `${currentDraft}${separator}${promptText}`
  return { draft, cursor: draft.length }
}
