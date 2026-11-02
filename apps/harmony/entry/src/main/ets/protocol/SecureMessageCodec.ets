import { MAX_SECURE_MESSAGE_BYTES, SECURE_FRAGMENT_CHUNK_BYTES } from './Protocol';

const MAGIC0: number = 0x44;
const MAGIC1: number = 0x53;
const MAGIC2: number = 0x48;
const MAGIC3: number = 0x46;
const FRAGMENT_VERSION: number = 1;
const FRAGMENT_HEADER_BYTES: number = 17;
const MAX_IN_FLIGHT_SECURE_MESSAGES: number = 8;

class FragmentAssembly {
  total: number = 0;
  totalBytes: number = 0;
  receivedBytes: number = 0;
  chunks: Uint8Array[] = [];
}

export class SecureMessageCodec {
  private nextMessageId: number = 1;
  private assemblies: Map<number, FragmentAssembly> = new Map();

  encode(message: Uint8Array): Uint8Array[] {
    if (message.byteLength > MAX_SECURE_MESSAGE_BYTES) {
      throw new Error('Secure message exceeds the reassembly limit.');
    }
    if (message.byteLength <= SECURE_FRAGMENT_CHUNK_BYTES) {
      const single: Uint8Array[] = [];
      single.push(message);
      return single;
    }
    const messageId = this.nextMessageId;
    this.nextMessageId = messageId === 0xffffffff ? 1 : messageId + 1;
    const total = Math.ceil(message.byteLength / SECURE_FRAGMENT_CHUNK_BYTES);
    const frames: Uint8Array[] = [];
    for (let index = 0; index < total; index += 1) {
      const start = index * SECURE_FRAGMENT_CHUNK_BYTES;
      const end = Math.min(message.byteLength, start + SECURE_FRAGMENT_CHUNK_BYTES);
      const chunk = message.subarray(start, end);
      const frame = new Uint8Array(FRAGMENT_HEADER_BYTES + chunk.byteLength);
      frame[0] = MAGIC0;
      frame[1] = MAGIC1;
      frame[2] = MAGIC2;
      frame[3] = MAGIC3;
      frame[4] = FRAGMENT_VERSION;
      const view = new DataView(frame.buffer);
      view.setUint32(5, messageId);
      view.setUint16(9, index);
      view.setUint16(11, total);
      view.setUint32(13, message.byteLength);
      frame.set(chunk, FRAGMENT_HEADER_BYTES);
      frames.push(frame);
    }
    return frames;
  }

  decode(frame: Uint8Array): Uint8Array | undefined {
    if (!this.isFragment(frame)) {
      return frame;
    }
    if (frame.byteLength < FRAGMENT_HEADER_BYTES || frame[4] !== FRAGMENT_VERSION) {
      throw new Error('Secure fragment header is invalid.');
    }
    const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
    const messageId = view.getUint32(5);
    const index = view.getUint16(9);
    const total = view.getUint16(11);
    const totalBytes = view.getUint32(13);
    if (messageId === 0 || total < 2 || index >= total
      || totalBytes <= SECURE_FRAGMENT_CHUNK_BYTES
      || totalBytes > MAX_SECURE_MESSAGE_BYTES
      || total !== Math.ceil(totalBytes / SECURE_FRAGMENT_CHUNK_BYTES)) {
      throw new Error('Secure fragment metadata is invalid.');
    }
    const expectedChunkBytes = Math.min(SECURE_FRAGMENT_CHUNK_BYTES,
      totalBytes - index * SECURE_FRAGMENT_CHUNK_BYTES);
    const chunk = frame.subarray(FRAGMENT_HEADER_BYTES);
    if (chunk.byteLength !== expectedChunkBytes) {
      throw new Error('Secure fragment length is invalid.');
    }
    let assembly = this.assemblies.get(messageId);
    if (assembly === undefined) {
      if (index !== 0 || this.assemblies.size >= MAX_IN_FLIGHT_SECURE_MESSAGES) {
        throw new Error('Secure fragment sequence is invalid.');
      }
      assembly = new FragmentAssembly();
      assembly.total = total;
      assembly.totalBytes = totalBytes;
      this.assemblies.set(messageId, assembly);
    }
    if (assembly.total !== total || assembly.totalBytes !== totalBytes || index !== assembly.chunks.length) {
      this.assemblies.delete(messageId);
      throw new Error('Secure fragment sequence is invalid.');
    }
    const copied = new Uint8Array(chunk.byteLength);
    copied.set(chunk);
    assembly.chunks.push(copied);
    assembly.receivedBytes += chunk.byteLength;
    if (assembly.chunks.length < total) {
      return undefined;
    }
    this.assemblies.delete(messageId);
    if (assembly.receivedBytes !== totalBytes) {
      throw new Error('Secure message length is invalid.');
    }
    const message = new Uint8Array(totalBytes);
    let offset = 0;
    for (const part of assembly.chunks) {
      message.set(part, offset);
      offset += part.byteLength;
    }
    return message;
  }

  reset(): void {
    this.nextMessageId = 1;
    this.assemblies.clear();
  }

  private isFragment(frame: Uint8Array): boolean {
    if (frame.byteLength < 4) {
      return false;
    }
    return frame[0] === MAGIC0 && frame[1] === MAGIC1 && frame[2] === MAGIC2 && frame[3] === MAGIC3;
  }
}
