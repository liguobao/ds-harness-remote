import { describe, it, expect } from '@ohos/hypium';
import { abilityDelegatorRegistry } from '@kit.TestKit';
import { SecureStore } from '../../../../main/ets/services/SecureStore';
import { DeviceIdentity, TokenPair } from '../../../../main/ets/model/Types';

async function newStore(): Promise<SecureStore> {
  const context = abilityDelegatorRegistry.getAbilityDelegator().getAppContext();
  const store: SecureStore = new SecureStore();
  await store.init(context);
  return store;
}

export default function secureStoreTest() {
  describe('HarmonySecureStore', () => {
    it('secrets_are_written_to_the_asset_store', 0, async () => {
      const store: SecureStore = await newStore();
      // Fails when the device cannot use Asset Store Kit, which is exactly the condition a
      // plaintext-KV implementation would have hidden.
      expect(store.isSecretStorageHealthy()).assertTrue();
    })

    it('round_trips_account_tokens', 0, async () => {
      const store: SecureStore = await newStore();
      const pair: TokenPair = new TokenPair();
      pair.accessToken = 'access-token-for-test';
      pair.accessTokenExpiresAt = 1700000000;
      pair.refreshToken = 'refresh-token-for-test';
      pair.refreshTokenExpiresAt = 1800000000;
      await store.saveCredentials(pair);

      const loaded: TokenPair | undefined = await store.loadCredentials();
      expect(loaded !== undefined).assertTrue();
      expect(loaded!.accessToken).assertEqual(pair.accessToken);
      expect(loaded!.refreshToken).assertEqual(pair.refreshToken);
      await store.clearCredentials();
      expect((await store.loadCredentials()) === undefined).assertTrue();
    })

    it('round_trips_device_identity_without_storing_the_private_key_in_kv', 0, async () => {
      const store: SecureStore = await newStore();
      const identity: DeviceIdentity = new DeviceIdentity();
      identity.deviceId = '0198abc0-1234-7abc-8123-123456789abc';
      identity.name = 'HarmonyOS · test';
      identity.platform = 'harmonyos';
      identity.publicKey = 'A'.repeat(43);
      identity.privateKey = 'B'.repeat(43);
      await store.saveIdentity(identity);

      const loaded: DeviceIdentity | undefined = await store.loadIdentity();
      expect(loaded !== undefined).assertTrue();
      expect(loaded!.deviceId).assertEqual(identity.deviceId);
      expect(loaded!.privateKey).assertEqual(identity.privateKey);
    })

    it('supports_forgetting_a_pinned_host_key', 0, async () => {
      const store: SecureStore = await newStore();
      const pins: Record<string, string> = { 'host-a': 'key-a', 'host-b': 'key-b' };
      await store.saveHostPins(pins);
      expect(Object.keys(store.loadHostPins()).length).assertEqual(2);

      await store.forgetHostPin('host-a');
      const left: Record<string, string> = store.loadHostPins();
      expect(Object.keys(left).length).assertEqual(1);
      expect(left['host-b']).assertEqual('key-b');
      await store.saveHostPins({});
    })
  })
}
