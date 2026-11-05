const P: bigint = (1n << 255n) - 19n;
const A24: bigint = 121665n;

export function clampScalar(bytes: Uint8Array): Uint8Array {
  const k = new Uint8Array(32);
  k.set(bytes);
  k[0] &= 248;
  k[31] &= 127;
  k[31] |= 64;
  return k;
}

function modPow(base: bigint, exp: bigint): bigint {
  let result = 1n;
  let b = base % P;
  let e = exp;
  while (e > 0n) {
    if ((e & 1n) === 1n) {
      result = (result * b) % P;
    }
    b = (b * b) % P;
    e >>= 1n;
  }
  return result;
}

export function x25519(scalarBytes: Uint8Array, pointBytes: Uint8Array): Uint8Array {
  const k = clampScalar(scalarBytes);
  let x: bigint = 0n;
  for (let i = 31; i >= 0; i--) {
    let b = pointBytes[i];
    if (i === 31) {
      b &= 127;
    }
    x = (x << 8n) | BigInt(b);
  }
  let n: bigint = 0n;
  for (let i = 31; i >= 0; i--) {
    n = (n << 8n) | BigInt(k[i]);
  }
  const x1 = x;
  let x2 = 1n;
  let z2 = 0n;
  let x3 = x;
  let z3 = 1n;
  let swap = 0n;
  for (let t = 254; t >= 0; t--) {
    const kt = (n >> BigInt(t)) & 1n;
    swap ^= kt;
    if (swap === 1n) {
      const tx = x2;
      x2 = x3;
      x3 = tx;
      const tz = z2;
      z2 = z3;
      z3 = tz;
    }
    swap = kt;
    const A = (x2 + z2) % P;
    const AA = (A * A) % P;
    const B = (x2 - z2 + P) % P;
    const BB = (B * B) % P;
    const E = (AA - BB + P) % P;
    const C = (x3 + z3) % P;
    const D = (x3 - z3 + P) % P;
    const DA = (D * A) % P;
    const CB = (C * B) % P;
    x3 = (DA + CB) % P;
    x3 = (x3 * x3) % P;
    z3 = (DA - CB + P) % P;
    z3 = (z3 * z3) % P;
    z3 = (z3 * x1) % P;
    x2 = (AA * BB) % P;
    z2 = (E * ((AA + A24 * E) % P)) % P;
  }
  if (swap === 1n) {
    const tx = x2;
    x2 = x3;
    x3 = tx;
    const tz = z2;
    z2 = z3;
    z3 = tz;
  }
  const res = (x2 * modPow(z2, P - 2n)) % P;
  const out = new Uint8Array(32);
  let r = res;
  for (let i = 0; i < 32; i++) {
    out[i] = Number(r & 0xffn);
    r >>= 8n;
  }
  let zero = true;
  for (let i = 0; i < 32; i++) {
    if (out[i] !== 0) {
      zero = false;
      break;
    }
  }
  if (zero) {
    throw new Error('X25519 low-order point');
  }
  return out;
}

export function x25519Public(secret: Uint8Array): Uint8Array {
  const base = new Uint8Array(32);
  base[0] = 9;
  return x25519(secret, base);
}
