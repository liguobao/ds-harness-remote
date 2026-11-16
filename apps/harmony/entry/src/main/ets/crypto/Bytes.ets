import { cryptoFramework } from '@kit.CryptoArchitectureKit';

const B64URL_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

export function utf8Encode(input: string): Uint8Array {
  let size = 0;
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    if (code < 0x80) {
      size += 1;
    } else if (code < 0x800) {
      size += 2;
    } else if (code >= 0xd800 && code <= 0xdbff && i + 1 < input.length) {
      const lo = input.charCodeAt(i + 1);
      if (lo >= 0xdc00 && lo <= 0xdfff) {
        size += 4;
        i += 1;
      } else {
        size += 3;
      }
    } else {
      size += 3;
    }
  }
  const out = new Uint8Array(size);
  let off = 0;
  for (let i = 0; i < input.length; i++) {
    let code = input.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      if (i + 1 < input.length) {
        const lo = input.charCodeAt(i + 1);
        if (lo >= 0xdc00 && lo <= 0xdfff) {
          code = 0x10000 + ((code - 0xd800) << 10) + (lo - 0xdc00);
          i += 1;
        } else {
          code = 0xfffd;
        }
      } else {
        code = 0xfffd;
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      code = 0xfffd;
    }
    if (code < 0x80) {
      out[off] = code;
      off += 1;
    } else if (code < 0x800) {
      out[off] = 0xc0 | (code >> 6);
      out[off + 1] = 0x80 | (code & 0x3f);
      off += 2;
    } else if (code < 0x10000) {
      out[off] = 0xe0 | (code >> 12);
      out[off + 1] = 0x80 | ((code >> 6) & 0x3f);
      out[off + 2] = 0x80 | (code & 0x3f);
      off += 3;
    } else {
      out[off] = 0xf0 | (code >> 18);
      out[off + 1] = 0x80 | ((code >> 12) & 0x3f);
      out[off + 2] = 0x80 | ((code >> 6) & 0x3f);
      out[off + 3] = 0x80 | (code & 0x3f);
      off += 4;
    }
  }
  return out;
}

export function utf8Decode(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i];
    let cp = 0;
    let len = 1;
    let bad = false;
    if (b < 0x80) {
      cp = b;
    } else if ((b & 0xe0) === 0xc0) {
      cp = b & 0x1f;
      len = 2;
    } else if ((b & 0xf0) === 0xe0) {
      cp = b & 0x0f;
      len = 3;
    } else if ((b & 0xf8) === 0xf0) {
      cp = b & 0x07;
      len = 4;
    } else {
      bad = true;
    }
    if (!bad && i + len > bytes.length) {
      bad = true;
    }
    if (!bad) {
      for (let j = 1; j < len; j++) {
        const c = bytes[i + j];
        if ((c & 0xc0) !== 0x80) {
          bad = true;
          break;
        }
        cp = (cp << 6) | (c & 0x3f);
      }
    }
    if (!bad && ((len === 2 && cp < 0x80) || (len === 3 && cp < 0x800) || (len === 4 && cp < 0x10000))) {
      bad = true;
    }
    if (!bad && cp >= 0xd800 && cp <= 0xdfff) {
      bad = true;
    }
    if (!bad && cp > 0x10ffff) {
      bad = true;
    }
    if (bad) {
      out += '\uFFFD';
      i += 1;
      continue;
    }
    if (cp < 0x10000) {
      out += String.fromCharCode(cp);
    } else {
      const v = cp - 0x10000;
      out += String.fromCharCode(0xd800 + (v >> 10), 0xdc00 + (v & 0x3ff));
    }
    i += len;
  }
  return out;
}

export function toBase64Url(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += B64URL_CHARS.charAt(b0 >> 2);
    out += B64URL_CHARS.charAt(((b0 & 3) << 4) | (b1 >> 4));
    if (i + 1 < bytes.length) {
      out += B64URL_CHARS.charAt(((b1 & 15) << 2) | (b2 >> 6));
    }
    if (i + 2 < bytes.length) {
      out += B64URL_CHARS.charAt(b2 & 63);
    }
  }
  return out;
}

export function fromBase64Url(value: string): Uint8Array {
  let end = value.length;
  while (end > 0 && value.charAt(end - 1) === '=') {
    end -= 1;
  }
  const clean = value.substring(0, end);
  const outLen = Math.floor(clean.length * 3 / 4);
  const out = new Uint8Array(outLen);
  let buffer = 0;
  let bits = 0;
  let off = 0;
  for (let i = 0; i < clean.length; i++) {
    const idx = B64URL_CHARS.indexOf(clean.charAt(i));
    if (idx < 0) {
      throw new Error('invalid base64url character');
    }
    buffer = (buffer << 6) | idx;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[off] = (buffer >> bits) & 0xff;
      off += 1;
    }
  }
  return out;
}

export function randomBytes(n: number): Uint8Array {
  try {
    const rand = cryptoFramework.createRandom();
    return rand.generateRandomSync(n).data;
  } catch (e) {
    throw new Error('random generation failed');
  }
}

export function randomUuid(): string {
  const b = randomBytes(16);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  let out = '';
  for (let i = 0; i < 16; i++) {
    if (i === 4 || i === 6 || i === 8 || i === 10) {
      out += '-';
    }
    out += ((b[i] >> 4) & 15).toString(16);
    out += (b[i] & 15).toString(16);
  }
  return out;
}

/**
 * RFC 9562 UUIDv7. The Server binds devices by this id and rejects anything that is not
 * a UUID or a ULID (see the `deviceId` field description in the production OpenAPI schema),
 * so raw hex ids from older builds must never be sent.
 */
export function uuidV7(): string {
  const b: Uint8Array = randomBytes(16);
  const ts: number = Date.now();
  b[0] = Math.floor(ts / 1099511627776) % 256;
  b[1] = Math.floor(ts / 4294967296) % 256;
  b[2] = Math.floor(ts / 16777216) % 256;
  b[3] = Math.floor(ts / 65536) % 256;
  b[4] = Math.floor(ts / 256) % 256;
  b[5] = ts % 256;
  b[6] = (b[6] & 15) + 112;
  b[8] = (b[8] & 63) + 128;
  let hex = '';
  for (let i = 0; i < 16; i++) {
    hex += (b[i] >> 4).toString(16);
    hex += (b[i] & 15).toString(16);
  }
  return hex.substring(0, 8) + '-' + hex.substring(8, 12) + '-' + hex.substring(12, 16) + '-'
    + hex.substring(16, 20) + '-' + hex.substring(20);
}

/**
 * Frame, RPC and message identifiers. The Server rejects any frame whose id is not a
 * UUIDv7/ULID (it closes the relay with 4008 "must be a UUIDv7 or ULID identifier"),
 * so ids must use this shape everywhere, not raw hex.
 */
export function randomId(): string {
  return uuidV7();
}

export function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < left.length; i++) {
    diff |= left[i] ^ right[i];
  }
  return diff === 0;
}

export function copyOf(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(bytes.length);
  out.set(bytes);
  return out;
}

export function concat2(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}

export function concat3(a: Uint8Array, b: Uint8Array, c: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length + c.length);
  out.set(a);
  out.set(b, a.length);
  out.set(c, a.length + b.length);
  return out;
}

export function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += (bytes[i] >> 4).toString(16);
    out += (bytes[i] & 15).toString(16);
  }
  return out;
}
