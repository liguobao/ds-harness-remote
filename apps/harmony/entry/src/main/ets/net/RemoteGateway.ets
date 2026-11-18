import { RemoteClientCore, RemoteClientError, RemoteEvent } from './RemoteClientCore';
import { jsonStr, jsonValue, asRecord, asBool, asArray } from '../protocol/Types';
import { randomId, utf8Encode } from '../crypto/Bytes';
import { DIRECT_REMOTE_CALL_BYTES, TransferError, callChunkedTransfer } from './TransferCodec';

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

/** Advertised agent backend entry inside `harness.transport.describe.workspaceTypes`. */
export class RemoteWorkspaceTypeDesc {
  id: string = '';
  capability: string = '';
  available: boolean = false;
  reason: string = '';
}

/** Negotiated Host capability profile (subset used by this client). */
export class RemoteHostFeatures {
  apiProxy: boolean = false;
  apiTransfer: boolean = false;
  remoteGateway: boolean = false;
  sessionFormat: number = 0;
  remoteTransfer: boolean = false;
  fileViewer: boolean = false;
  sessionEvents: boolean = false;
  pluginRoute: boolean = false;
  huaweiPush: boolean = false;
  binaryUploads: boolean = false;
  asyncCompaction: boolean = false;
  capabilities: string[] = [];
  workspaceTypes: RemoteWorkspaceTypeDesc[] = [];
  hasWorkspaceTypesField: boolean = false;

  hasCapability(cap: string): boolean {
    return this.capabilities.includes(cap);
  }

  supportsWorkspaceType(id: string, capability: string): boolean {
    if (!this.hasCapability(capability)) {
      return false;
    }
    if (!this.hasWorkspaceTypesField) {
      return true;
    }
    let matchCount = 0;
    let available = false;
    for (const item of this.workspaceTypes) {
      if (item.id === id) {
        matchCount += 1;
        if (item.capability === capability && item.available) {
          available = true;
        }
      }
    }
    return matchCount === 1 && available;
  }
}

/** Client-side Typert Gateway carrier over the authenticated Remote channel. */
export class RemoteGateway {
  private client: RemoteClientCore;
  private features: RemoteHostFeatures = new RemoteHostFeatures();

  constructor(client: RemoteClientCore) {
    this.client = client;
  }

  getClient(): RemoteClientCore {
    return this.client;
  }

  getFeatures(): RemoteHostFeatures {
    return this.features;
  }

  /**
   * One `harness.remote.call` round trip with automatic chunked transfer fallback
   * for large payloads or `RESPONSE_TOO_LARGE`. Unwraps the Gateway result envelope.
   */
  async call(endpoint: string, payload: Object, timeoutMs?: number, maxResponseBytes?: number): Promise<Object> {
    const params: Record<string, Object> = {
      'endpoint': endpoint,
      'payload': payload
    };
    const encoded: Uint8Array = utf8Encode(JSON.stringify(params));
    let response: Object;
    try {
      if (encoded.byteLength > DIRECT_REMOTE_CALL_BYTES) {
        response = await callChunkedTransfer(
          this.client, 'harness.remote.transfer', randomId(), encoded, timeoutMs, maxResponseBytes);
      } else {
        try {
          response = await this.client.rpc('harness.remote.call', params, timeoutMs, endpoint);
        } catch (innerError) {
          if (innerError instanceof RemoteClientError && innerError.code === 'RESPONSE_TOO_LARGE') {
            response = await callChunkedTransfer(
              this.client, 'harness.remote.transfer', randomId(), encoded, timeoutMs, maxResponseBytes);
          } else {
            throw toGatewayError(innerError as Object);
          }
        }
      }
    } catch (error) {
      throw toGatewayError(error as Object);
    }
    return parseGatewayResult(response);
  }

  async submitCompaction(sessionId: string, requestId: string, budgetMs?: number): Promise<Object> {
    const params: Record<string, Object> = {
      'sessionId': sessionId,
      'requestId': requestId
    };
    if (budgetMs !== undefined && budgetMs > 0) {
      params['budgetMs'] = budgetMs;
    }
    try {
      return await this.client.rpc('harness.remote.compaction.submit', params, undefined,
        'harness.remote.compaction.submit');
    } catch (error) {
      throw toGatewayError(error as Object);
    }
  }

  async compactionStatus(sessionId: string, operationId: string): Promise<Object> {
    const params: Record<string, Object> = {
      'sessionId': sessionId,
      'operationId': operationId
    };
    try {
      return await this.client.rpc('harness.remote.compaction.status', params, undefined,
        'harness.remote.compaction.status');
    } catch (error) {
      throw toGatewayError(error as Object);
    }
  }

  async cancelCompaction(sessionId: string, operationId: string): Promise<Object> {
    const params: Record<string, Object> = {
      'sessionId': sessionId,
      'operationId': operationId
    };
    try {
      return await this.client.rpc('harness.remote.compaction.cancel', params, undefined,
        'harness.remote.compaction.cancel');
    } catch (error) {
      throw toGatewayError(error as Object);
    }
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
    features.apiTransfer = true;
    features.capabilities = ['harness.api.v1'];
    let value: Object;
    try {
      value = await this.client.rpc('harness.transport.describe', {});
    } catch (error) {
      if (error instanceof RemoteClientError && error.code === 'METHOD_NOT_FOUND') {
        this.features = features;
        return features;
      }
      throw toGatewayError(error as Object);
    }
    const root: Record<string, Object> | undefined = asRecord(value);
    if (root === undefined) {
      throw new RemoteGatewayError('INVALID_MESSAGE', 'The remote Host returned invalid transport capabilities.');
    }
    features.capabilities = [];
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
    features.apiTransfer = features.capabilities.includes('harness.api.transfer.v1') || apiProxy;
    features.remoteGateway = remoteV1 || remoteV3;
    features.remoteTransfer = features.capabilities.includes('harness.remote.transfer.v1');
    features.fileViewer = features.capabilities.includes('fileviewer.read.v1');
    features.sessionEvents = features.capabilities.includes('harness.remote.session-events.v1');
    features.pluginRoute = features.capabilities.includes('plugin.route.v1');
    features.huaweiPush = features.capabilities.includes('push.huawei.v1');
    features.binaryUploads = features.capabilities.includes('workspace.upload.v1')
      && features.capabilities.includes('workspace.upload.binary.v1');
    features.asyncCompaction = features.capabilities.includes('harness.remote.compaction.v1');
    const rawWorkspaceTypes: Object | undefined = root['workspaceTypes'];
    if (rawWorkspaceTypes !== undefined) {
      features.hasWorkspaceTypesField = true;
      features.workspaceTypes = parseWorkspaceTypes(rawWorkspaceTypes);
    }
    if (!apiProxy && !features.remoteGateway) {
      throw new RemoteGatewayError('FEATURE_NOT_SUPPORTED', 'The remote Host exposes no supported Harness transport.');
    }
    this.features = features;
    return features;
  }
}

function parseWorkspaceTypes(raw: Object): RemoteWorkspaceTypeDesc[] {
  const arr: Object[] | undefined = asArray(raw);
  if (arr === undefined || arr.length > 64) {
    return [];
  }
  const out: RemoteWorkspaceTypeDesc[] = [];
  for (const item of arr) {
    const rec: Record<string, Object> | undefined = asRecord(item);
    if (rec === undefined) {
      continue;
    }
    const id: string = jsonStr(rec, 'id', '');
    const capability: string = jsonStr(rec, 'capability', '');
    if (id.length === 0 || capability.length === 0) {
      continue;
    }
    const desc: RemoteWorkspaceTypeDesc = new RemoteWorkspaceTypeDesc();
    desc.id = id;
    desc.capability = capability;
    desc.available = asBool(rec['available']) === true;
    desc.reason = jsonStr(rec, 'reason', '');
    out.push(desc);
  }
  return out;
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
  if (error instanceof TransferError) {
    return new RemoteGatewayError(error.code, error.message);
  }
  if (error instanceof RemoteClientError) {
    return new RemoteGatewayError(error.code, error.message);
  }
  if (error instanceof Error) {
    return new RemoteGatewayError('internal', error.message);
  }
  return new RemoteGatewayError('internal', 'The remote request failed.');
}
