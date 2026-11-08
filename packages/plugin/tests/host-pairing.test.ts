import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, expect, it, vi } from 'vitest';
import { generateKeyPair } from '@dsh-remote/crypto';
import { HostPairing, pairingProof } from '../src/host-pairing.js';
import { IdentityStore, assertOwnedRemoteStorage } from '../src/identity-store.js';
import { HostServerApi } from '../src/server-api.js';
import { ServerCredentialStore } from '../src/server-credentials.js';
import vectors from '../../../fixtures/pairing/v1/proof.json' with { type: 'json' };
const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
async function setup(compactQr = false) {
    const directory = await mkdtemp(join(tmpdir(), 'remote-pairing-'));
    directories.push(directory);
    const identity = await new IdentityStore({ directory }).loadOrCreate('Host');
    const host = { deviceId: identity.deviceId, name: identity.name, role: 'host' as const, platform: 'desktop', identityKey: identity.publicKey };
    const session = { v: 1, sessionId: '019a0000-0000-7000-8000-000000000001', expiresAt: Date.now() + 180000, serverPublicKey: generateKeyPair().publicKey, scanSecret: generateKeyPair().publicKey, host };
    let state = 'claimed';
    let lose = false;
    const submissions: string[] = [];
    const credentials = { account: 'device:test', accountKind: 'device_only' as const, device: host, inboundOnly: true, pairingRestricted: true, tokens: { accessToken: 'access-token-0123456789', accessTokenExpiresAt: Date.now() + 600000, refreshToken: 'refresh-token-0123456789', refreshTokenExpiresAt: Date.now() + 86400000 } };
    const adopt = vi.fn(async () => { });
    const fetcher = vi.fn<typeof fetch>(async (url, init) => {
        const path = new URL(String(url)).pathname;
        if (path.endsWith('/oauth/providers')) return Response.json({ capabilities: compactQr ? { devicePairingQr: 'fragment-ticket-v1' } : {} });
        if (path.endsWith('/sessions'))
            return Response.json(session);
        if (path.endsWith('/confirm')) {
            submissions.push(String(init!.body));
            if (lose) {
                lose = false;
                state = 'approved';
                throw new Error('response lost');
            }
            state = 'completed';
        }
        return Response.json({ v: 1, sessionId: session.sessionId, state, expiresAt: session.expiresAt, recoverUntil: session.expiresAt + 300000, failureReason: state === 'failed' ? 'verification_failed' : null, attemptConsumed: submissions.length > 0, submissionId: submissions.length ? JSON.parse(submissions[0]!).submissionId : null, host, mobile: { ...host, deviceId: 'phone', role: 'client', identityKey: vectors.devicePublicKey }, credentials: state === 'completed' ? credentials : null });
    });
    return { directory, identity, host, session, adopt, fetcher, credentials, submissions, create: () => new HostPairing('http://127.0.0.1:8081', directory, identity, host, adopt, fetcher), lose: () => { lose = true; }, fail: () => { state = 'failed'; } };
}
it('matches independent C#/Python X25519/HKDF/HMAC fixtures', () => { for (const v of vectors.vectors)
    expect(pairingProof(vectors.devicePrivateKey, vectors.serverPublicKey, vectors.sessionId, v.path, v.body, v.side as 'host' | 'mobile')).toBe(v.proof); });
it('freezes one encrypted submission across response loss/restart and adopts credentials only once', async () => {
    const f = await setup();
    const first = f.create();
    await first.start();
    await first.status();
    f.lose();
    await expect(first.confirm(f.session.sessionId, '00123456')).rejects.toMatchObject({ code: 'PAIRING_CONNECTION_FAILED' });
    const file = join(f.directory, 'host-pairing.json');
    expect(await readFile(file, 'utf8')).not.toContain('00123456');
    if (process.platform !== 'win32')
        expect((await stat(file)).mode & 0o777).toBe(0o600);
    await assertOwnedRemoteStorage(f.directory);
    first.close();
    const resumed = f.create();
    expect(await resumed.status()).toMatchObject({ state: 'approved', canRetry: true });
    await expect(resumed.confirm(f.session.sessionId, '11111111')).rejects.toMatchObject({ code: 'PAIRING_ATTEMPT_USED' });
    const result = await resumed.confirm(f.session.sessionId);
    expect(result).toMatchObject({ state: 'completed', localSaved: true, canRetry: false });
    expect(f.submissions).toHaveLength(2);
    expect(f.submissions[0]).toBe(f.submissions[1]);
    expect(JSON.stringify(result)).not.toContain('access-token');
    await resumed.status();
    resumed.close();
    const next = f.create();
    await next.status();
    expect(f.adopt).toHaveBeenCalledTimes(1);
    await next.discard();
    await expect(readFile(file)).rejects.toMatchObject({ code: 'ENOENT' });
});
it('rejects terminal/stale sessions and changed Host keys before any adoption', async () => {
    const f = await setup();
    const p = f.create();
    await p.start();
    await p.status();
    f.fail();
    expect(await p.status()).toMatchObject({ state: 'failed' });
    await expect(p.confirm(f.session.sessionId, '00123456')).rejects.toMatchObject({ code: 'INVALID_MESSAGE' });
    await expect(p.confirm('019a0000-0000-7000-8000-000000000002', '00123456')).rejects.toMatchObject({ code: 'PAIRING_CLOSED' });
    expect(f.submissions).toHaveLength(0);
    expect(f.adopt).not.toHaveBeenCalled();
    f.fetcher.mockResolvedValueOnce(Response.json({ ...f.session, host: { ...f.host, identityKey: vectors.devicePublicKey } }));
    await expect(p.start()).rejects.toThrow();
});
it('persists Host-only policy and authorization metadata through refresh and legacy ownership validation', async () => {
    const f = await setup();
    const store = new ServerCredentialStore(f.directory);
    const api = new HostServerApi('http://127.0.0.1:8081', store, async () => Response.json({ ...f.credentials.tokens, accessToken: 'new-access-token-0123456789' }));
    api.bindIdentity(f.identity);
    await api.adoptPairing(f.credentials);
    await api.refreshCredentials();
    expect(await store.load(api.baseUrl, f.identity.deviceId)).toMatchObject({ authorizationMethod: 'device_pairing', pairingRestricted: true, accountKind: 'device_only' });
    const restored = new HostServerApi(api.baseUrl, store);
    restored.bindIdentity(f.identity);
    await restored.loadStoredPolicy();
    expect(restored.pairingHostOnly()).toBe(true);
    await assertOwnedRemoteStorage(f.directory);
    await expect(restored.adoptPairing({ ...f.credentials, account: 'other' })).rejects.toMatchObject({ code: 'PAIRING_ACCOUNT_CONFLICT' });
    await restored.clearAuthorization();
    await restored.loadStoredPolicy();
    expect(restored.pairingHostOnly()).toBe(true);
    await writeFile(join(f.directory, 'pairing-host-only.json'), '{"hostOnly":false}');
    await expect(assertOwnedRemoteStorage(f.directory)).rejects.toThrow();
    api.close();
    restored.close();
});
it('fails closed on old servers and expires vanished sessions without allowing a new code attempt', async () => {
    const f = await setup();
    const bad = vi.fn<typeof fetch>(async () => new Response('old Server', { status: 404 }));
    const p = new HostPairing('http://127.0.0.1:8081', f.directory, f.identity, f.host, f.adopt, bad);
    await expect(p.start()).rejects.toMatchObject({ code: 'PAIRING_UNSUPPORTED' });
    expect(bad.mock.calls[0]![1]).toMatchObject({ redirect: 'error' });
    const existing = f.create();
    await existing.start();
    f.fetcher.mockResolvedValueOnce(Response.json({ error: { code: 'PAIRING_NOT_FOUND' } }, { status: 404 }));
    expect(await existing.status()).toMatchObject({ state: 'expired', canRetry: false });
});

it('uses a short fragment ticket only when advertised and retains it across restart', async () => {
    const f = await setup(true);
    const pairing = f.create();
    const view = await pairing.start();
    expect(view.qrPayload).toBe(`http://127.0.0.1:8081/pair#v1.${f.session.scanSecret}`);
    expect(view.qrPayload).not.toContain(f.session.serverPublicKey);
    expect(view.qrPayload).not.toContain(f.session.sessionId);
    await assertOwnedRemoteStorage(f.directory);
    expect(JSON.parse(await readFile(join(f.directory, 'host-pairing.json'), 'utf8')).qrFormat).toBe('fragment-ticket-v1');
    pairing.close();
});
it('preserves full JSON QR compatibility when compact discovery is absent', async () => {
    const f = await setup();
    const pairing = f.create();
    expect(JSON.parse((await pairing.start()).qrPayload!)).toMatchObject({ type: 'dsh.remote.pairing', ...f.session });
    pairing.close();
});
