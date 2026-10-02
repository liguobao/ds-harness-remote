import type {
  LegacyWireStreamOpen,
  LocalTypertGateway,
  Rc1WireStreamOpen,
  RemoteTypertGatewayTarget,
  TypertGatewayLike,
  TypertGatewayRequest,
  TypertRpcResult,
} from './typert-gateway-contract.js'

type RemoteInvoke = (request: TypertGatewayRequest) => Promise<unknown>
type CarrierDispatch = (endpoint: string, payload: unknown, signal: AbortSignal) => Promise<TypertRpcResult>
type CarrierOpen = (endpoint: string, payload: unknown, signal: AbortSignal) => Promise<AsyncIterable<unknown>>

/**
 * dsh 0.1.7-rc.1 private carrier dispatcher:
 * `openWireStream(endpoint, payload, uplink, peer, signal, control)`. The public
 * `wireStream.open` omits `control`; both move the signal out of the third slot.
 */
type Rc1OpenWireStream = (
  endpoint: string,
  payload: unknown,
  uplink: AsyncIterable<unknown>,
  peer: unknown,
  signal: AbortSignal,
  control: AbortController,
) => Promise<AsyncIterable<unknown>>

interface RuntimeGateway extends TypertGatewayLike {
  // Alpha Connection adapters call these prototype methods dynamically.
  dispatchRpc?: CarrierDispatch
  openWireStream?: CarrierOpen | Rc1OpenWireStream
}

const REMOTE_COMMAND_METHODS = ['execute', 'list'] as const
const LOCAL_ONLY_NAMESPACES = new Set(['dynamicCordisRunner'])

export interface RemoteCommandSupport {
  execute: boolean
  list: boolean
}

const ALL_REMOTE_COMMANDS: RemoteCommandSupport = { execute: true, list: true }

/** Keeps the official Gateway object stable while its selected Host changes. */
export class TypertGatewaySwitch {
  private readonly runtime: RuntimeGateway
  private readonly originalInvoke: TypertGatewayLike['invoke']
  private readonly localInvoke: TypertGatewayLike['invoke']
  private readonly originalStream?: NonNullable<TypertGatewayLike['stream']>
  private readonly localStream?: NonNullable<TypertGatewayLike['stream']>
  private readonly originalDispatch?: CarrierDispatch
  private readonly localDispatch?: CarrierDispatch
  private readonly originalOpen?: CarrierOpen | Rc1OpenWireStream
  private readonly localOpen?: CarrierOpen
  private remoteInvoke?: RemoteInvoke
  private remoteTarget?: RemoteTypertGatewayTarget
  private remoteSupport: RemoteCommandSupport = { execute: false, list: false }
  private target?: { deviceId: string; name: string }
  private installed = false

  constructor(gateway: TypertGatewayLike) {
    this.runtime = gateway as RuntimeGateway
    this.originalInvoke = gateway.invoke
    this.localInvoke = this.originalInvoke.bind(gateway)
    this.originalStream = gateway.stream
    this.localStream = gateway.stream?.bind(gateway)
    this.originalDispatch = this.runtime.dispatchRpc
    this.localDispatch = this.runtime.dispatchRpc?.bind(gateway)
    this.originalOpen = this.runtime.openWireStream
    this.localOpen = createLocalOpen(gateway, this.runtime)
  }

  /** Original local dispatcher, used by the Host bridge without switch recursion. */
  local(): LocalTypertGateway {
    const dispatch: CarrierDispatch = this.localDispatch ?? (async (endpoint, payload, signal) => {
      try {
        const request = requestFromCarrier(endpoint, payload, signal)
        return { ok: true, value: await this.localInvoke(request) }
      } catch (error) {
        return { ok: false, error: this.failure(error) }
      }
    })
    const open: CarrierOpen = this.localOpen ?? (async (endpoint, payload, signal) => {
      if (this.localStream === undefined) throw new Error('The local Harness Gateway does not support Remote streams.')
      return this.localStream(requestFromCarrier(endpoint, payload, signal))
    })
    return {
      invoke: this.localInvoke,
      ...(this.localStream === undefined ? {} : { stream: this.localStream }),
      dispatch,
      open,
      failure: error => this.failure(error),
      supportsCarrier: this.localDispatch !== undefined && this.localOpen !== undefined,
    }
  }

  supportsCarrier(): boolean {
    return this.localDispatch !== undefined && this.localOpen !== undefined
  }

  status(): { mode: 'local' | 'remote'; target?: { deviceId: string; name: string } } {
    return this.remoteInvoke === undefined
      ? { mode: 'local' }
      : { mode: 'remote', ...(this.target === undefined ? {} : { target: { ...this.target } }) }
  }

  install(): void {
    if (this.installed) return
    this.runtime.invoke = request => this.selectInvoke(request)
    if (this.originalStream !== undefined) {
      this.runtime.stream = request => this.remoteTarget === undefined || isLocalOnlyEndpoint(endpointOf(request))
        ? this.localStream!(request)
        : this.remoteTarget.open(endpointOf(request), { args: request.args }, request.signal ?? new AbortController().signal)
    }
    if (this.originalDispatch !== undefined) {
      this.runtime.dispatchRpc = (endpoint, payload, signal) => this.remoteTarget === undefined || isLocalOnlyEndpoint(endpoint)
        ? this.localDispatch!(endpoint, payload, signal)
        : this.remoteTarget.dispatch(endpoint, payload, signal)
    }
    if (this.originalOpen !== undefined) {
      const open = this.originalOpen
      const rc1 = usesRc1Arity(open)
      this.runtime.openWireStream = (...callArgs: unknown[]) => {
        const endpoint = callArgs[0] as string
        if (this.remoteTarget === undefined || isLocalOnlyEndpoint(endpoint)) {
          return rc1
            ? Reflect.apply(open, this.runtime, callArgs) as Promise<AsyncIterable<unknown>>
            : (open as CarrierOpen).call(this.runtime, endpoint, callArgs[1], callArgs[2] as AbortSignal)
        }
        const signal = (rc1 ? callArgs[4] : callArgs[2]) as AbortSignal | undefined
        return this.remoteTarget.open(endpoint, callArgs[1], signal ?? new AbortController().signal)
      }
    }
    this.installed = true
  }

  selectRemote(
    remote: RemoteInvoke | RemoteTypertGatewayTarget,
    support: RemoteCommandSupport = ALL_REMOTE_COMMANDS,
    target?: { deviceId: string; name: string },
  ): void {
    if (!this.installed) throw new Error('The Typert gateway switch is not installed.')
    this.remoteInvoke = typeof remote === 'function' ? remote : request => remote.invoke(request)
    this.remoteTarget = typeof remote === 'function' ? undefined : remote
    this.remoteSupport = { ...support }
    this.target = target === undefined ? undefined : { ...target }
  }

  selectLocal(): void {
    this.remoteInvoke = undefined
    this.remoteTarget = undefined
    this.remoteSupport = { execute: false, list: false }
    this.target = undefined
  }

  restore(): void {
    if (!this.installed) return
    this.selectLocal()
    this.runtime.invoke = this.originalInvoke
    if (this.originalStream !== undefined) this.runtime.stream = this.originalStream
    if (this.originalDispatch !== undefined) this.runtime.dispatchRpc = this.originalDispatch
    if (this.originalOpen !== undefined) this.runtime.openWireStream = this.originalOpen
    this.installed = false
  }

  private selectInvoke(request: TypertGatewayRequest): Promise<unknown> {
    if (isLocalOnlyEndpoint(endpointOf(request))) return this.localInvoke(request)
    if (this.remoteTarget !== undefined) return this.remoteTarget.invoke(request)
    if (request.namespace !== 'commands' || !isRemoteCommandMethod(request.method) || this.remoteInvoke === undefined) {
      return this.localInvoke(request)
    }
    if (this.remoteSupport[request.method]) return this.remoteInvoke(request)
    if (request.method === 'list') return Promise.resolve([])
    return this.localInvoke(request)
  }

  private failure(error: unknown): { code: string; message: string; details: Record<string, unknown> } {
    const normalized = this.runtime.wireStream?.failure(error)
    if (normalized !== undefined) return normalized
    const source = error instanceof Error ? error : new Error('The Harness Gateway rejected the request.')
    const code = 'code' in source && typeof source.code === 'string' ? source.code : 'internal'
    const details = 'details' in source && isRecord(source.details) ? source.details : {}
    return { code, message: source.message, details }
  }
}

/**
 * dsh 0.1.7-rc.1 moved the cancellation signal from the third parameter to the
 * fifth; legacy releases keep `(endpoint, payload, signal)`.
 * @param open - carrier opener captured from the running release.
 * @returns whether the opener follows the rc.1 argument order.
 */
function usesRc1Arity(open: { readonly length: number }): boolean {
  return open.length >= 5
}

/** An uplink nobody sends on, so a read-only stream opens without buffering. */
function endedUplink(): AsyncIterable<unknown> {
  return {
    [Symbol.asyncIterator](): AsyncIterator<unknown> {
      return { next: () => Promise.resolve({ done: true, value: undefined }) }
    },
  }
}

/** Controller aborted with the logical stream so the rc.1 carrier owns one lifetime. */
function linkControl(signal: AbortSignal): AbortController {
  const control = new AbortController()
  if (signal.aborted) control.abort(signal.reason)
  else signal.addEventListener('abort', () => control.abort(signal.reason), { once: true })
  return control
}

/**
 * Adapt the running release's carrier opener to the plugin's 3-argument
 * `(endpoint, payload, signal)` seam without leaking the argument displacement.
 * @param gateway - official Gateway whose public `wireStream` is the fallback.
 * @param runtime - Gateway object owning the private `openWireStream` dispatcher.
 * @returns a local opener that carries the signal to the release's signal slot.
 */
function createLocalOpen(gateway: TypertGatewayLike, runtime: RuntimeGateway): CarrierOpen | undefined {
  const open = runtime.openWireStream
  if (open !== undefined) {
    return usesRc1Arity(open)
      ? (endpoint, payload, signal) => (open as Rc1OpenWireStream)
        .call(runtime, endpoint, payload, endedUplink(), undefined, signal, linkControl(signal))
      : (endpoint, payload, signal) => (open as CarrierOpen).call(runtime, endpoint, payload, signal)
  }
  const wire = gateway.wireStream
  if (wire === undefined) return undefined
  const wireOpen = wire.open
  if (usesRc1Arity(wireOpen)) {
    const rc1 = wireOpen as Rc1WireStreamOpen
    return (endpoint, payload, signal) => rc1.call(wire, endpoint, payload, endedUplink(), undefined, signal)
  }
  const legacy = wireOpen as LegacyWireStreamOpen
  return (endpoint, payload, signal) => legacy.call(wire, endpoint, payload, signal)
}

function requestFromCarrier(endpoint: string, payload: unknown, signal: AbortSignal): TypertGatewayRequest {
  const segments = endpoint.split('/')
  if (segments.length !== 2 || segments.some(segment => segment.length === 0)) {
    throw new Error('The Harness Gateway endpoint is invalid.')
  }
  if (!isRecord(payload) || !isRecord(payload.args)) {
    throw new Error('The Harness Gateway payload is invalid.')
  }
  return { namespace: segments[0]!, method: segments[1]!, args: payload.args, signal }
}

function endpointOf(request: TypertGatewayRequest): string {
  return `${request.namespace}/${request.method}`
}

function isLocalOnlyEndpoint(endpoint: string): boolean {
  const separator = endpoint.indexOf('/')
  return separator > 0 && LOCAL_ONLY_NAMESPACES.has(endpoint.slice(0, separator))
}

function isRemoteCommandMethod(method: string): method is typeof REMOTE_COMMAND_METHODS[number] {
  return (REMOTE_COMMAND_METHODS as readonly string[]).includes(method)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
