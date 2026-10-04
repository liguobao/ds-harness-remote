import type { SafeLogger } from '../../logging.js'
import { AntigravityAcpClient } from './antigravity-process.js'
import { adaptCursorProcess, type AcpBackendAdapter } from '../adapter.js'
import type { CursorAcpLike } from './cursor-process.js'

/** Antigravity ACP backend: Antigravity CLI `agy --input-format stream-json --output-format stream-json` over Host stdio. */
export function createAntigravityAcpAdapter(
  binary: string = 'agy',
  logger?: SafeLogger,
  createProcess: (binary: string, logger?: SafeLogger) => CursorAcpLike = (path, targetLogger) => (
    new AntigravityAcpClient(path, targetLogger)
  ),
): AcpBackendAdapter {
  return adaptCursorProcess(createProcess(binary, logger), 'antigravity')
}

export { AntigravityAcpClient, AntigravityAcpError } from './antigravity-process.js'
export * from './antigravity/index.js'
