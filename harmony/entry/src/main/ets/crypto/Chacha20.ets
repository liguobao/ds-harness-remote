function rotl(v: number, c: number): number {
  return ((v << c) | (v >>> (32 - c))) >>> 0;
}

function qr(x: Uint32Array, a: number, b: number, c: number, d: number): void {
  x[a] = (x[a] + x[b]) >>> 0;
  x[d] = rotl(x[d] ^ x[a], 16);
  x[c] = (x[c] + x[d]) >>> 0;
  x[b] = rotl(x[b] ^ x[c], 12);
  x[a] = (x[a] + x[b]) >>> 0;
  x[d] = rotl(x[d] ^ x[a], 8);
  x[c] = (x[c] + x[d]) >>> 0;
  x[b] = rotl(x[b] ^ x[c], 7);
}

export function chacha20Block(key: Uint8Array, counter: number, nonce: Uint8Array): Uint8Array {
  const st = new Uint32Array(16);
  const kd = new DataView(key.buffer, key.byteOffset, 32);
  const nd = new DataView(nonce.buffer, nonce.byteOffset, 12);
  st[0] = 0x61707865;
  st[1] = 0x3320646e;
  st[2] = 0x79622d32;
  st[3] = 0x6b206574;
  for (let i = 0; i < 8; i++) {
    st[4 + i] = kd.getUint32(i * 4, true);
  }
  st[12] = counter >>> 0;
  st[13] = nd.getUint32(0, true);
  st[14] = nd.getUint32(4, true);
  st[15] = nd.getUint32(8, true);
  const x = new Uint32Array(16);
  x.set(st);
  for (let i = 0; i < 10; i++) {
    qr(x, 0, 4, 8, 12);
    qr(x, 1, 5, 9, 13);
    qr(x, 2, 6, 10, 14);
    qr(x, 3, 7, 11, 15);
    qr(x, 0, 5, 10, 15);
    qr(x, 1, 6, 11, 12);
    qr(x, 2, 7, 8, 13);
    qr(x, 3, 4, 9, 14);
  }
  const out = new Uint8Array(64);
  const odv = new DataView(out.buffer);
  for (let i = 0; i < 16; i++) {
    odv.setUint32(i * 4, (x[i] + st[i]) >>> 0, true);
  }
  return out;
}

export function chacha20Xor(key: Uint8Array, counter: number, nonce: Uint8Array, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(data.length);
  for (let off = 0; off < data.length; off += 64) {
    const block = chacha20Block(key, counter + Math.floor(off / 64), nonce);
    const n = Math.min(64, data.length - off);
    for (let i = 0; i < n; i++) {
      out[off + i] = data[off + i] ^ block[i];
    }
  }
  return out;
}

const P13: bigint = (1n << 130n) - 5n;
const MASK128: bigint = (1n << 128n) - 1n;

function poly1305(key: Uint8Array, data: Uint8Array): Uint8Array {
  let r: bigint = 0n;
  for (let i = 15; i >= 0; i--) {
    r = (r << 8n) | BigInt(key[i]);
  }
  r &= 0x0ffffffc0ffffffc0ffffffc0fffffffn;
  let s: bigint = 0n;
  for (let i = 31; i >= 16; i--) {
    s = (s << 8n) | BigInt(key[i]);
  }
  let acc: bigint = 0n;
  for (let off = 0; off < data.length; off += 16) {
    const n = Math.min(16, data.length - off);
    let blk: bigint = 0n;
    for (let i = n - 1; i >= 0; i--) {
      blk = (blk << 8n) | BigInt(data[off + i]);
    }
    blk |= 1n << BigInt(n * 8);
    acc = (((acc + blk) % P13) * r) % P13;
  }
  let v = (acc + s) & MASK128;
  const out = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

export function poly1305Tag(key: Uint8Array, nonce: Uint8Array, aad: Uint8Array, ciphertext: Uint8Array): Uint8Array {
  const block = chacha20Block(key, 0, nonce);
  const polyKey = block.subarray(0, 32);
  const pad1 = (16 - (aad.length % 16)) % 16;
  const pad2 = (16 - (ciphertext.length % 16)) % 16;
  const lenBuf = new Uint8Array(16);
  const ldv = new DataView(lenBuf.buffer);
  ldv.setUint32(0, aad.length, true);
  ldv.setUint32(8, ciphertext.length, true);
  const full = new Uint8Array(aad.length + pad1 + ciphertext.length + pad2 + 16);
  full.set(aad, 0);
  full.set(ciphertext, aad.length + pad1);
  full.set(lenBuf, aad.length + pad1 + ciphertext.length + pad2);
  return poly1305(polyKey, full);
}

export function chacha20poly1305Seal(key: Uint8Array, nonce: Uint8Array, aad: Uint8Array,
  plaintext: Uint8Array): Uint8Array {
  const ciphertext = chacha20Xor(key, 1, nonce, plaintext);
  const tag = poly1305Tag(key, nonce, aad, ciphertext);
  const out = new Uint8Array(ciphertext.length + 16);
  out.set(ciphertext);
  out.set(tag, ciphertext.length);
  return out;
}

export function chacha20poly1305Open(key: Uint8Array, nonce: Uint8Array, aad: Uint8Array,
  ciphertextWithTag: Uint8Array): Uint8Array {
  if (ciphertextWithTag.length < 16) {
    throw new Error('ChaChaPoly: too short');
  }
  const cLen = ciphertextWithTag.length - 16;
  const ciphertext = ciphertextWithTag.subarray(0, cLen);
  const tag = ciphertextWithTag.subarray(cLen);
  const expectTag = poly1305Tag(key, nonce, aad, ciphertext);
  let diff = 0;
  for (let i = 0; i < 16; i++) {
    diff |= tag[i] ^ expectTag[i];
  }
  if (diff !== 0) {
    throw new Error('ChaChaPoly: auth failed');
  }
  return chacha20Xor(key, 1, nonce, ciphertext);
}
