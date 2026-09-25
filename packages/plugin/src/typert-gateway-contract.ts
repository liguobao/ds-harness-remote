export interface TypertGatewayRequest {
  namespace: string
  method: string
  args: Readonly<Record<string, unknown>>
  signal?: AbortSignal
}

export type TypertRpcResult =
  | { ok: true; value?: unknown }
  | { ok: false; error: { code: string; message: string; details: Record<string, unknown> } }

/** Legacy carrier open (≤0.1.6): the third argument is the cancellation signal. */
export type LegacyWireStreamOpen = (
  endpoint: string,
  payload: unknown,
  signal: AbortSignal,
) => Promise<AsyncIterable<unknown>>

/**
 * dsh 0.1.7-rc.1 carrier open: the third argument is the Client uplink and the
 * cancellation signal moves to the fifth position. Passing an `AbortSignal` as
 * the third argument makes the Host throw `signals[0] is not of type AbortSignal`.
 */
export type Rc1WireStreamOpen = (
  endpoint: string,
  payload: unknown,
  uplink: AsyncIterable<unknown>,
  peer: unknown,
  signal: AbortSignal,
) => Promise<AsyncIterable<unknown>>

/** Carrier open signature of the running Harness release. */
export type TypertWireStreamOpen = LegacyWireStreamOpen | Rc1WireStreamOpen

export interface TypertGatewayWireStreamLike {
  open: TypertWireStreamOpen
  failure(error: unknown): { code: string; message: string; details: Record<string, unknown> }
}

/** Public Gateway face shared by Harness rc.2 and alpha releases. */
export interface TypertGatewayLike {
  invoke(request: TypertGatewayRequest): Promise<unknown>
  stream?(request: TypertGatewayRequest): Promise<AsyncIterable<unknown>>
  wireStream?: TypertGatewayWireStreamLike
}

/** Carrier-level face captured from the alpha Gateway before target switching. */
export interface LocalTypertGateway extends TypertGatewayLike {
  dispatch(endpoint: string, payload: unknown, signal: AbortSignal): Promise<TypertRpcResult>
  open(endpoint: string, payload: unknown, signal: AbortSignal): Promise<AsyncIterable<unknown>>
  failure(error: unknown): { code: string; message: string; details: Record<string, unknown> }
  supportsCarrier: boolean
}

export interface RemoteTypertGatewayTarget {
  invoke(request: TypertGatewayRequest): Promise<unknown>
  dispatch(endpoint: string, payload: unknown, signal: AbortSignal): Promise<TypertRpcResult>
  open(endpoint: string, payload: unknown, signal: AbortSignal): Promise<AsyncIterable<unknown>>
}
