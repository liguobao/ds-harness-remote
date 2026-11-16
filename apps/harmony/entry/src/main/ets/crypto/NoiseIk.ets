import { utf8Encode, copyOf } from './Bytes';
import { sha256Concat, hkdf2 } from './Sha256';
import { x25519, x25519Public } from './X25519';
import { chacha20poly1305Seal, chacha20poly1305Open } from './Chacha20';

export class CipherState {
  private key: Uint8Array;
  private n: bigint = 0n;

  constructor(key: Uint8Array) {
    this.key = copyOf(key);
  }

  private nonceBytes(): Uint8Array {
    const b = new Uint8Array(12);
    new DataView(b.buffer).setBigUint64(4, this.n, true);
    return b;
  }

  encrypt(ad: Uint8Array, plaintext: Uint8Array): Uint8Array {
    const out = chacha20poly1305Seal(this.key, this.nonceBytes(), ad, plaintext);
    this.n += 1n;
    return out;
  }

  decrypt(ad: Uint8Array, ciphertext: Uint8Array): Uint8Array {
    const out = chacha20poly1305Open(this.key, this.nonceBytes(), ad, ciphertext);
    this.n += 1n;
    return out;
  }
}

export class NoiseIkInitiator {
  private random: (n: number) => Uint8Array;
  private h: Uint8Array;
  private ck: Uint8Array;
  private cipher: CipherState | undefined = undefined;
  private rs: Uint8Array;
  private sPriv: Uint8Array;
  private sPub: Uint8Array;
  private ePriv: Uint8Array | undefined = undefined;
  private send: CipherState | undefined = undefined;
  private recv: CipherState | undefined = undefined;

  constructor(localPrivate: Uint8Array, localPublic: Uint8Array, remotePublic: Uint8Array,
    prologue: Uint8Array, random: (n: number) => Uint8Array) {
    this.random = random;
    const name = utf8Encode('Noise_IK_25519_ChaChaPoly_SHA256');
    this.h = new Uint8Array(32);
    this.h.set(name);
    this.ck = copyOf(this.h);
    this.rs = copyOf(remotePublic);
    this.sPriv = copyOf(localPrivate);
    this.sPub = copyOf(localPublic);
    this.mixHash(prologue);
    this.mixHash(remotePublic);
  }

  private mixHash(data: Uint8Array): void {
    this.h = sha256Concat(this.h, data);
  }

  private mixKey(ikm: Uint8Array): void {
    const res = hkdf2(this.ck, ikm);
    this.ck = res.o1;
    this.cipher = new CipherState(res.o2);
  }

  private encryptAndHash(plaintext: Uint8Array): Uint8Array {
    let out: Uint8Array;
    if (this.cipher !== undefined) {
      out = this.cipher.encrypt(this.h, plaintext);
    } else {
      out = copyOf(plaintext);
    }
    this.mixHash(out);
    return out;
  }

  private decryptAndHash(data: Uint8Array): Uint8Array {
    let out: Uint8Array;
    if (this.cipher !== undefined) {
      out = this.cipher.decrypt(this.h, data);
    } else {
      out = copyOf(data);
    }
    this.mixHash(data);
    return out;
  }

  writeHandshake(payload: Uint8Array): Uint8Array {
    const ePriv = this.random(32);
    this.ePriv = ePriv;
    const ePub = x25519Public(ePriv);
    this.mixHash(ePub);
    this.mixKey(x25519(ePriv, this.rs));
    const encS = this.encryptAndHash(this.sPub);
    this.mixKey(x25519(this.sPriv, this.rs));
    const encPayload = this.encryptAndHash(payload);
    const out = new Uint8Array(32 + encS.length + encPayload.length);
    out.set(ePub, 0);
    out.set(encS, 32);
    out.set(encPayload, 32 + encS.length);
    return out;
  }

  readHandshake(message: Uint8Array): Uint8Array {
    if (message.length < 48) {
      throw new Error('handshake message too short');
    }
    const ePriv = this.ePriv;
    if (ePriv === undefined) {
      throw new Error('handshake not started');
    }
    const re = message.subarray(0, 32);
    this.mixHash(re);
    this.mixKey(x25519(ePriv, re));
    this.mixKey(x25519(this.sPriv, re));
    const payload = this.decryptAndHash(message.subarray(32));
    const res = hkdf2(this.ck, new Uint8Array(0));
    this.send = new CipherState(res.o1);
    this.recv = new CipherState(res.o2);
    return payload;
  }

  isComplete(): boolean {
    return this.send !== undefined && this.recv !== undefined;
  }

  encrypt(plaintext: Uint8Array): Uint8Array {
    if (this.send === undefined) {
      throw new Error('noise handshake not complete');
    }
    return this.send.encrypt(new Uint8Array(0), plaintext);
  }

  decrypt(ciphertext: Uint8Array): Uint8Array {
    if (this.recv === undefined) {
      throw new Error('noise handshake not complete');
    }
    return this.recv.decrypt(new Uint8Array(0), ciphertext);
  }
}
