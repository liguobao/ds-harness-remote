import { RemoteClientCore, RemoteClientError, RemoteEvent } from './RemoteClientCore';
import { jsonStr, jsonValue, asRecord, asBool } from '../protocol/Types';
import { randomId } from '../crypto/Bytes';

/** Gateway-level failure raised by RemoteGateway and HarnessAlphaClient. */
export class RemoteGatewayError extends Error {
  readonly code: string;
  readonly details: Record<string, Object>;

  constructor(code: string, message: string, details?: Record<string, Object>) {
    super(message);
    this.code = code;
    this.details = details !== undefined ? details : {};
  }
}

/** Callbacks receiving the frames of one `harness.remote.stream`. */
export class StreamHandler {
  onFrame: (value: Object) => void = () => {};
  onClosed: (error: RemoteGatewayError | undefined) => void = () => {};
}

/**
 * One live `harness.remote.stream.*` subscription.
 *
 * The Host delivers frames as `harness.remote.frame` events tagged with the
 * stream id and terminates with a `harness.remote.stream.closed` event whose
 * reason is `cancelled | completed | failed | peer-disconnected`.
 */
export class RemoteGatewayStream {
  readonly streamId: string;
  private client: RemoteClientCore;
  private handler: StreamHandler;
  private closed: boolean = false;
  private unsubscribes: (() => void)[] = [];

  constructor(streamId: string, client: RemoteClientCore, handler: StreamHandler) {
    this.streamId = streamId;
    this.client = client;
    this.handler = handler;
  }

  /** Subscribe to client events; called by RemoteGateway.open before the open RPC. */
  attach(): void {
    this.unsubscribes.push(this.client.onEvent((event: RemoteEvent) => {
      this.routeEvent(event);
    }));
    this.unsubscribes.push(this.client.onClose((error: Error | undefined) => {
      this.fail(new RemoteGatewayError('TRANSPORT_CLOSED', 'The remote stream transport closed.'));
    }));
  }

  /** Stop routing; optionally tell the Host to release the stream slot. */
  close(notifyRemote: boolean): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.detach();
    if (notifyRemote) {
      const params: Record<string, Object> = { 'streamId': this.streamId };
      const closeCall: Promise<Object> = this.client.rpc('harness.remote.stream.close', params, 5000);
      closeCall.catch((error: Error) => {
        return;
      });
    }
  }

  isClosed(): boolean {
    return this.closed;
  }

  private routeEvent(event: RemoteEvent): void {
    if (this.closed) {
      return;
    }
    if (event.event === 'harness.remote.frame') {
      this.routeFrameEvent(event);
      return;
    }
    if (event.event === 'harness.remote.stream.closed') {
      this.routeClosedEvent(event);
    }
  }

  private routeFrameEvent(event: RemoteEvent): void {
    const data: Record<string, Object> | undefined = asRecord(event.data);
    if (data === undefined) {
      return;
    }
    const streamId: string = jsonStr(data, 'streamId', '');
    const hasValue: boolean = asBool(data['hasValue']) === true;
    if (streamId !== this.streamId || !hasValue) {
      return;
    }
    const value: Object | undefined = jsonValue(data, 'value');
    if (value !== undefined) {
      this.handler.onFrame(value);
    }
  }

  private routeClosedEvent(event: RemoteEvent): void {
    const data: Record<string, Object> | undefined = asRecord(event.data);
    if (data === undefined) {
      return;
    }
    const streamId: string = jsonStr(data, 'streamId', '');
    if (streamId !== this.streamId) {
      return;
    }
    const reason: string = jsonStr(data, 'reason', '');
    if (reason === 'failed') {
      const failure: Record<string, Object> | undefined = asRecord(data['failure']);
      this.fail(new RemoteGatewayError(
        failure !== undefined ? jsonStr(failure, 'code', 'internal') : 'internal',
        failure !== undefined ? jsonStr(failure, 'message', 'The remote stream failed.')
          : 'The remote stream failed.'));
      return;
    }
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.detach();
    this.handler.onClosed(undefined);
  }

  private fail(error: RemoteGatewayError): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.detach();
    this.handler.onClosed(error);
  }

  private detach(): void {
    for (const unsubscribe of this.unsubscribes) {
      unsubscribe();
    }
    this.unsubscribes = [];
  }
}

/** Negotiated Host capability profile (subset used by this client). */
export class RemoteHostFeatures {
  apiProxy: boolean = false;
  remoteGateway: boolean = false;
  sessionFormat: number = 0;
  capabilities: string[] = [];
}

/** Client-side Typert Gateway carrier over the authenticated Remote channel. */
export class RemoteGateway {
  private client: RemoteClientCore;

  constructor(client: RemoteClientCore) {
    this.client = client;
  }

  /** One `harness.remote.call` round trip; unwraps the Gateway result envelope. */
  async call(endpoint: string, payload: Object, timeoutMs?: number): Promise<Object> {
    const params: Record<string, Object> = {
      'endpoint': endpoint,
      'payload': payload
    };
    let response: Object;
    try {
      response = await this.client.rpc('harness.remote.call', params, timeoutMs, endpoint);
    } catch (error) {
      throw toGatewayError(error);
    }
    return parseGatewayResult(response);
  }

  /** Open one `harness.remote.stream`; frames flow through `handler`. */
  async open(endpoint: string, payload: Object, handler: StreamHandler,
    timeoutMs?: number): Promise<RemoteGatewayStream> {
    const stream: RemoteGatewayStream = new RemoteGatewayStream(randomId(), this.client, handler);
    stream.attach();
    const params: Record<string, Object> = {
      'streamId': stream.streamId,
      'endpoint': endpoint,
      'payload': payload
    };
    try {
      await this.client.rpc('harness.remote.stream.open', params, timeoutMs, endpoint);
    } catch (error) {
      // The Host registers the stream before the open RPC settles: a failed
      // open must still release the slot or it leaks until disconnect.
      stream.close(true);
      throw toGatewayError(error);
    }
    return stream;
  }

  /** Describe the Host's transport capabilities via `harness.transport.describe`. */
  async probeHostFeatures(): Promise<RemoteHostFeatures> {
    const features: RemoteHostFeatures = new RemoteHostFeatures();
    features.apiProxy = true;
    features.capabilities = ['harness.api.v1'];
    let value: Object;
    try {
      value = await this.client.rpc('harness.transport.describe', {});
    } catch (error) {
      if (error instanceof RemoteClientError && error.code === 'METHOD_NOT_FOUND') {
        return features;
      }
      throw toGatewayError(error);
    }
    const root: Record<string, Object> | undefined = asRecord(value);
    if (root === undefined) {
      throw new RemoteGatewayError('INVALID_MESSAGE', 'The remote Host returned invalid transport capabilities.');
    }
    const rawCapabilities: Object | undefined = root['capabilities'];
    if (Array.isArray(rawCapabilities)) {
      const list = rawCapabilities as Object[];
      for (const item of list) {
        if (typeof item === 'string') {
          features.capabilities.push(item);
        }
      }
    }
    const apiProxy: boolean = features.capabilities.includes('harness.api.v1');
    const remoteV1: boolean = features.capabilities.includes('harness.remote.v1');
    const remoteV3: boolean = features.capabilities.includes('harness.remote.v3');
    if (remoteV1 && remoteV3) {
      throw new RemoteGatewayError('INVALID_MESSAGE', 'The remote Host advertised conflicting Harness Session formats.');
    }
    if (remoteV3) {
      features.sessionFormat = 3;
    }
    features.apiProxy = apiProxy;
    features.remoteGateway = remoteV1 || remoteV3;
    if (!apiProxy && !features.remoteGateway) {
      throw new RemoteGatewayError('FEATURE_NOT_SUPPORTED', 'The remote Host exposes no supported Harness transport.');
    }
    return features;
  }
}

function parseGatewayResult(response: Object): Object {
  const root: Record<string, Object> | undefined = asRecord(response);
  if (root === undefined) {
    throw new RemoteGatewayError('INVALID_MESSAGE', 'The remote Host returned an invalid Gateway result.');
  }
  const okValue: Object | undefined = root['ok'];
  if (okValue === true) {
    const value: Object | undefined = root['value'];
    return value !== undefined ? value : new Object();
  }
  if (okValue === false) {
    const error: Record<string, Object> | undefined = asRecord(root['error']);
    if (error !== undefined) {
      const code: string = jsonStr(error, 'code', 'internal');
      const message: string = jsonStr(error, 'message', 'The Host rejected the Remote request.');
      throw new RemoteGatewayError(code, message);
    }
  }
  throw new RemoteGatewayError('INVALID_MESSAGE', 'The remote Host returned an invalid Gateway failure.');
}

/** Normalize any thrown value into a RemoteGatewayError. */
export function toGatewayError(error: Object): RemoteGatewayError {
  if (error instanceof RemoteGatewayError) {
    return error;
  }
  if (error instanceof RemoteClientError) {
    return new RemoteGatewayError(error.code, error.message);
  }
  if (error instanceof Error) {
    return new RemoteGatewayError('internal', error.message);
  }
  return new RemoteGatewayError('internal', 'The remote request failed.');
}
