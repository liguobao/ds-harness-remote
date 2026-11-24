export type RemoteClientErrorCode =
  | 'RPC_TIMEOUT'
  | 'RPC_ABORTED'
  | 'TRANSPORT_CLOSED'
  | 'CLIENT_CLOSED'

export class RemoteClientError extends Error {
  constructor(
    readonly code: RemoteClientErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'RemoteClientError'
  }
}
