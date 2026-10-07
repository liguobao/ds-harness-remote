import type { SafeLogger } from '../../logging.js'
import { CursorAcpClient, type CursorAcpLike } from './cursor-process.js'
import { adaptCursorProcess, type AcpBackendAdapter } from '../adapter.js'

/** First external ACP backend (#65): Cursor CLI `agent acp` over Host stdio. */
export function createCursorAcpAdapter(
  binary: string,
  logger?: SafeLogger,
  createProcess: (binary: string, logger?: SafeLogger) => CursorAcpLike = (path, targetLogger) => (
    new CursorAcpClient(path, targetLogger)
  ),
): AcpBackendAdapter {
  return adaptCursorProcess(createProcess(binary, logger))
}

export { CursorAcpClient, CursorAcpError } from './cursor-process.js'
export type {
  CursorAcpInbound,
  CursorAcpLike,
  CursorAcpNotification,
  CursorAcpRequest,
  SpawnCursorAcp,
} from './cursor-process.js'
