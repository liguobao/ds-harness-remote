import { describe, it, expect } from '@ohos/hypium';
import { CipherState } from '../../../../main/ets/crypto/NoiseIk';
import { x25519, x25519Public } from '../../../../main/ets/crypto/X25519';
import { constantTimeEqual } from '../../../../main/ets/crypto/Bytes';

function pattern(length: number, seed: number): Uint8Array {
  const out: Uint8Array = new Uint8Array(length);
  for (let i = 0; i < length; i++) {
    out[i] = (i * 31 + seed) & 0xff;
  }
  return out;
}

export default function cryptoTest() {
  describe('HarmonyCrypto', () => {
    it('x25519_agreement_is_symmetric', 0, () => {
      const aliceSecret: Uint8Array = pattern(32, 7);
      const bobSecret: Uint8Array = pattern(32, 19);
      const alicePublic: Uint8Array = x25519Public(aliceSecret);
      const bobPublic: Uint8Array = x25519Public(bobSecret);
      const aliceShared: Uint8Array = x25519(aliceSecret, bobPublic);
      const bobShared: Uint8Array = x25519(bobSecret, alicePublic);
      expect(constantTimeEqual(aliceShared, bobShared)).assertTrue();
    })

    it('chacha20poly1305_roundtrip_and_tamper_rejection', 0, () => {
      const cipher: CipherState = new CipherState(pattern(32, 3));
      const ad: Uint8Array = pattern(16, 11);
      const plaintext: Uint8Array = pattern(512, 23);
      const sealed: Uint8Array = cipher.encrypt(ad, plaintext);
      expect(sealed.length === plaintext.length + 16).assertTrue();

      const reader: CipherState = new CipherState(pattern(32, 3));
      const opened: Uint8Array = reader.decrypt(ad, sealed);
      expect(constantTimeEqual(opened, plaintext)).assertTrue();

      // A single flipped bit in the tag must fail authentication, not return garbage.
      const broken: Uint8Array = sealed.slice();
      broken[broken.length - 1] = broken[broken.length - 1] ^ 0x01;
      const other: CipherState = new CipherState(pattern(32, 3));
      let rejected: boolean = false;
      try {
        other.decrypt(ad, broken);
      } catch (error) {
        rejected = true;
      }
      expect(rejected).assertTrue();
    })

    it('rejects_a_frame_decrypted_with_the_wrong_key', 0, () => {
      const writer: CipherState = new CipherState(pattern(32, 5));
      const sealed: Uint8Array = writer.encrypt(new Uint8Array(0), pattern(64, 29));
      const wrongKey: CipherState = new CipherState(pattern(32, 6));
      let rejected: boolean = false;
      try {
        wrongKey.decrypt(new Uint8Array(0), sealed);
      } catch (error) {
        rejected = true;
      }
      expect(rejected).assertTrue();
    })
  })
}
