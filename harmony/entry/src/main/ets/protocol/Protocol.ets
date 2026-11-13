import { randomId, utf8Encode, utf8Decode } from '../crypto/Bytes';
import { ParsedFrame, parseFrame } from './Types';

export const PROTOCOL_VERSION: number = 1;
export const MAX_CONTROL_FRAME_BYTES: number = 64 * 1024;
export const MAX_RELAY_FRAME_BYTES: number = 1024 * 1024;
export const SECURE_FRAGMENT_CHUNK_BYTES: number = 48 * 1024;
export const MAX_SECURE_MESSAGE_BYTES: number = 4 * 1024 * 1024;
export const HARNESS_API_TRANSFER_CHUNK_BYTES: number = 512 * 1024;
export const HELLO_TIMEOUT_MS: number = 5000;
export const DEFAULT_HEARTBEAT_INTERVAL_MS: number = 25000;
export const HEARTBEAT_DISCONNECT_MS: number = 75000;
export const RPC_TIMEOUT_MS: number = 30000;

export function createNoisePrologue(connectionId: string, hostDeviceId: string, clientDeviceId: string): Uint8Array {
  return utf8Encode(`DSH-REMOTE\0v=1\0connection=${connectionId}\0host=${hostDeviceId}\0client=${clientDeviceId}`);
}

export function buildControlFrameJson(type: string, payload: Record<string, Object>): string {
  const frame: Record<string, Object> = {
    'v': PROTOCOL_VERSION,
    'id': randomId(),
    'type': type,
    'timestamp': Date.now(),
    'payload': payload
  };
  return JSON.stringify(frame);
}

export function buildRelayDataFrameJson(type: string, payload: Record<string, Object>): string {
  const frame: Record<string, Object> = {
    'v': PROTOCOL_VERSION,
    'id': randomId(),
    'type': type,
    'timestamp': Date.now(),
    'payload': payload
  };
  return JSON.stringify(frame);
}

export function encodeRemoteMessage(type: string, payload: Record<string, Object>, id: string): Uint8Array {
  const frame: Record<string, Object> = {
    'v': PROTOCOL_VERSION,
    'id': id,
    'type': type,
    'timestamp': Date.now(),
    'payload': payload
  };
  return utf8Encode(JSON.stringify(frame));
}

export function buildRpcRequestMessage(method: string, params: Record<string, Object>, id: string): Uint8Array {
  const payload: Record<string, Object> = {
    'method': method,
    'params': params
  };
  return encodeRemoteMessage('rpc.request', payload, id);
}

export function decodeRemoteMessage(data: Uint8Array): ParsedFrame {
  return parseFrame(utf8Decode(data));
}
