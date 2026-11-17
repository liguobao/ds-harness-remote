import { strings } from '../locales/i18n'

export function sessionToolsError(error: unknown): string {
  const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined
  if (code === 'TERMINAL_DISABLED') return strings.tools.terminalDisabled
  if (code === 'terminal/control-unavailable') return strings.tools.controlDenied
  if (code === 'PERMISSION_DENIED') return strings.tools.accessDenied
  if (code === 'workspace-preview/too-large' || code === 'RESPONSE_TOO_LARGE') return strings.tools.previewTooLarge
  if (code === 'workspace-preview/changed') return strings.tools.previewChanged
  if (code === 'workspace-preview/invalid') return strings.tools.previewInvalid
  if (code === 'workspace-preview/unsupported') return strings.tools.previewUnsupported
  if (code === 'RPC_TIMEOUT') return strings.errors.RPC_TIMEOUT
  if (code === 'document-render/failed') {
    const details = typeof error === 'object' && error !== null && 'details' in error ? error.details : undefined
    const reason = typeof details === 'object' && details !== null && 'reason' in details ? details.reason : undefined
    if (reason === 'unavailable') return strings.tools.officeUnavailable
    if (reason === 'input-too-large' || reason === 'output-too-large') return strings.tools.tooLarge
    if (reason === 'timeout' || reason === 'busy') return strings.tools.officeBusy
    if (reason === 'source-changed') return strings.tools.previewChanged
    return strings.tools.officeFailed
  }
  if (code === 'FEATURE_NOT_SUPPORTED' || code === 'METHOD_NOT_ALLOWED' || code === 'METHOD_NOT_FOUND'
    || code === 'not-found' || code === 'unknown-endpoint'
    || code === 'gateway/service-unavailable' || code === 'gateway/method-unavailable'
    || code === 'gateway/definition-unavailable' || code === 'gateway/invocation-unavailable') return strings.tools.unsupported
  if (code === 'workspace-file/not-text') return strings.tools.notText
  if (code === 'workspace-file/too-large') return strings.tools.tooLarge
  return strings.tools.failed
}
