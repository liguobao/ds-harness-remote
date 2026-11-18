import { utf8Decode, utf8Encode } from '../crypto/Bytes';
import { RemoteClientCore, RemoteClientError } from './RemoteClientCore';
import { asRecord, jsonNum, jsonStr, jsonValue } from '../protocol/Types';

export const DIRECT_REMOTE_CALL_BYTES = 2 * 1024 * 1024;
export const TRANSFER_CHUNK_BYTES = 512 * 1024;
export const MAX_TRANSFER_BYTES = 288 * 1024 * 1024;
export const DEFAULT_TRANSFER_TIMEOUT_MS = 60000;
export const DEFAULT_TRANSFER_CHUNK_TIMEOUT_MS = 30000;
export const TRANSFER_CLOSE_TIMEOUT_MS = 5000;

const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_LOOKUP = buildBase64Lookup();

function buildBase64Lookup(): Int16Array {
  const table = new Int16Array(256);
  for (let i = 0; i < 256; i++) {
    table[i] = -1;
  }
  for (let i = 0; i < B64_ALPHABET.length; i++) {
    table[B64_ALPHABET.charCodeAt(i)] = i;
  }
  return table;
}

/** RFC 4648 base64 encoder safe across ArkTS and Node test harnesses. */
export function bytesToBase64(bytes: Uint8Array): string {
  const len: number = bytes.length;
  if (len === 0) {
    return '';
  }
  const chunks: string[] = [];
  let i: number = 0;
  while (i + 2 < len) {
    const n: number = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    chunks.push(
      B64_ALPHABET.charAt((n >>> 18) & 0x3f) +
      B64_ALPHABET.charAt((n >>> 12) & 0x3f) +
      B64_ALPHABET.charAt((n >>> 6) & 0x3f) +
      B64_ALPHABET.charAt(n & 0x3f)
    );
    i += 3;
  }
  if (i < len) {
    const a: number = bytes[i];
    const hasSecond: boolean = i + 1 < len;
    const b: number = hasSecond ? bytes[i + 1] : 0;
    const n: number = (a << 16) | (b << 8);
    chunks.push(
      B64_ALPHABET.charAt((n >>> 18) & 0x3f) +
      B64_ALPHABET.charAt((n >>> 12) & 0x3f) +
      (hasSecond ? B64_ALPHABET.charAt((n >>> 6) & 0x3f) : '=') +
      '='
    );
  }
  return chunks.join('');
}

/** Base64url without padding (used for dsh-session mention URIs). */
export function utf8ToBase64Url(text: string): string {
  const b64: string = bytesToBase64(utf8Encode(text));
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Strict RFC 4648 base64 decoder throwing Error on malformed input. */
export function base64ToBytes(value: string): Uint8Array {
  if (value.length === 0) {
    return new Uint8Array(0);
  }
  if (value.length % 4 !== 0) {
    throw new Error('Malformed base64 length.');
  }
  let pad: number = 0;
  if (value.endsWith('==')) {
    pad = 2;
  } else if (value.endsWith('=')) {
    pad = 1;
  }
  const bodyLen: number = value.length;
  const outLen: number = (bodyLen / 4) * 3 - pad;
  const out: Uint8Array = new Uint8Array(outLen);
  let outPos: number = 0;
  for (let i = 0; i < bodyLen; i += 4) {
    const c0: number = value.charCodeAt(i);
    const c1: number = value.charCodeAt(i + 1);
    const c2: number = value.charCodeAt(i + 2);
    const c3: number = value.charCodeAt(i + 3);
    const v0: number = c0 < 256 ? B64_LOOKUP[c0] : -1;
    const v1: number = c1 < 256 ? B64_LOOKUP[c1] : -1;
    const isPad2: boolean = c2 === 61 && i + 4 === bodyLen;
    const isPad3: boolean = c3 === 61 && i + 4 === bodyLen;
    const v2: number = isPad2 ? 0 : (c2 < 256 ? B64_LOOKUP[c2] : -1);
    const v3: number = isPad3 ? 0 : (c3 < 256 ? B64_LOOKUP[c3] : -1);
    if (v0 < 0 || v1 < 0 || (!isPad2 && v2 < 0) || (!isPad3 && v3 < 0) || (isPad2 && !isPad3)) {
      throw new Error('Invalid base64 character.');
    }
    const triple: number = (v0 << 18) | (v1 << 12) | (v2 << 6) | v3;
    if (outPos < outLen) {
      out[outPos++] = (triple >>> 16) & 0xff;
    }
    if (!isPad2 && outPos < outLen) {
      out[outPos++] = (triple >>> 8) & 0xff;
    }
    if (!isPad3 && outPos < outLen) {
      out[outPos++] = triple & 0xff;
    }
  }
  return out;
}

export class TransferError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

/**
 * Chunked RPC transfer (`*.transfer.{open,chunk,commit,read,close}`) shared across
 * `harness.remote.transfer`, `codex.app.transfer`, and `agent.acp.transfer`.
 */
export async function callChunkedTransfer(
  client: RemoteClientCore,
  prefix: string,
  transferId: string,
  encoded: Uint8Array,
  timeoutMs?: number,
  maxResponseBytes?: number
): Promise<Object> {
  if (encoded.byteLength > MAX_TRANSFER_BYTES) {
    throw new TransferError('REQUEST_TOO_LARGE', 'The Remote transfer request exceeds the transfer limit.');
  }
  const totalChunks: number = Math.max(1, Math.ceil(encoded.byteLength / TRANSFER_CHUNK_BYTES));
  const overallTimeoutMs: number = timeoutMs !== undefined && timeoutMs > 0
    ? timeoutMs
    : Math.max(DEFAULT_TRANSFER_TIMEOUT_MS, totalChunks * 2000);
  const startedAt: number = Date.now();
  const nextBudget = (cap: number): number => {
    const remaining: number = overallTimeoutMs - (Date.now() - startedAt);
    if (remaining <= 0) {
      throw new TransferError('RPC_TIMEOUT', `Transfer ${transferId} timed out after ${overallTimeoutMs}ms.`);
    }
    return cap > 0 && remaining > cap ? cap : remaining;
  };

  let opened: boolean = false;
  try {
    const openParams: Record<string, Object> = {
      'transferId': transferId,
      'totalBytes': encoded.byteLength,
      'totalChunks': totalChunks
    };
    await client.rpc(`${prefix}.open`, openParams, nextBudget(DEFAULT_TRANSFER_CHUNK_TIMEOUT_MS),
      `${prefix}.open`);
    opened = true;

    for (let index = 0; index < totalChunks; index++) {
      const start: number = index * TRANSFER_CHUNK_BYTES;
      const end: number = Math.min(start + TRANSFER_CHUNK_BYTES, encoded.byteLength);
      const chunk: Uint8Array = encoded.subarray(start, end);
      const chunkParams: Record<string, Object> = {
        'transferId': transferId,
        'index': index,
        'data': bytesToBase64(chunk)
      };
      await client.rpc(`${prefix}.chunk`, chunkParams, nextBudget(DEFAULT_TRANSFER_CHUNK_TIMEOUT_MS),
        `${prefix}.chunk`);
    }

    const commitParams: Record<string, Object> = { 'transferId': transferId };
    const committedRaw: Object = await client.rpc(`${prefix}.commit`, commitParams, nextBudget(0),
      `${prefix}.commit`);
    const committed: Record<string, Object> | undefined = asRecord(committedRaw);
    if (committed === undefined) {
      throw new TransferError('INVALID_MESSAGE', 'Host returned an invalid transfer commit response.');
    }
    const kind: string = jsonStr(committed, 'kind', '');
    if (kind === 'inline') {
      const inlineResp: Object | undefined = jsonValue(committed, 'response');
      return inlineResp !== undefined ? inlineResp : new Object();
    }
    if (kind !== 'chunked') {
      throw new TransferError('INVALID_MESSAGE', 'Host returned an unknown transfer commit kind.');
    }
    const respTransferId: string = jsonStr(committed, 'transferId', '');
    const totalBytes: number = jsonNum(committed, 'totalBytes', -1);
    const respChunks: number = jsonNum(committed, 'totalChunks', -1);
    const expectedChunks: number = Math.ceil(totalBytes / TRANSFER_CHUNK_BYTES);
    if (respTransferId !== transferId || totalBytes <= 0 || totalBytes > MAX_TRANSFER_BYTES
      || respChunks !== expectedChunks) {
      throw new TransferError('INVALID_MESSAGE', 'Host returned an invalid chunked transfer descriptor.');
    }
    if (maxResponseBytes !== undefined && totalBytes > maxResponseBytes) {
      throw new TransferError('RESPONSE_TOO_LARGE', 'The remote response exceeds the requested transfer limit.');
    }

    const responseBytes: Uint8Array = new Uint8Array(totalBytes);
    let offset: number = 0;
    for (let index = 0; index < respChunks; index++) {
      const readParams: Record<string, Object> = { 'transferId': transferId, 'index': index };
      const partRaw: Object = await client.rpc(`${prefix}.read`, readParams,
        nextBudget(DEFAULT_TRANSFER_CHUNK_TIMEOUT_MS), `${prefix}.read`);
      const part: Record<string, Object> | undefined = asRecord(partRaw);
      if (part === undefined || jsonStr(part, 'transferId', '') !== transferId
        || jsonNum(part, 'index', -1) !== index) {
        throw new TransferError('INVALID_MESSAGE', 'Host returned an out-of-order transfer chunk.');
      }
      const chunkBytes: Uint8Array = base64ToBytes(jsonStr(part, 'data', ''));
      const expectedBytes: number = Math.min(TRANSFER_CHUNK_BYTES, totalBytes - offset);
      if (chunkBytes.byteLength !== expectedBytes) {
        throw new TransferError('INVALID_MESSAGE', 'Host returned a transfer chunk with unexpected size.');
      }
      responseBytes.set(chunkBytes, offset);
      offset += chunkBytes.byteLength;
    }

    const jsonText: string = utf8Decode(responseBytes);
    const parsed: Object = JSON.parse(jsonText) as Object;
    return parsed !== undefined && parsed !== null ? parsed : new Object();
  } catch (error) {
    if (error instanceof TransferError) {
      throw error;
    }
    if (error instanceof RemoteClientError) {
      throw new TransferError(error.code, error.message);
    }
    throw new TransferError('TRANSFER_FAILED', error instanceof Error ? error.message : String(error));
  } finally {
    if (opened) {
      const closeParams: Record<string, Object> = { 'transferId': transferId };
      await client.rpc(`${prefix}.close`, closeParams, TRANSFER_CLOSE_TIMEOUT_MS, `${prefix}.close`)
        .catch(() => undefined);
    }
  }
}
