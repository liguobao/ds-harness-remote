import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, expect, it, vi } from 'vitest';
import { generateKeyPair } from '@dsh-remote/crypto';
import { runScenarios } from '../../../scripts/test-scenarios.mjs';
import { resolveConfig } from '../src/config.js';
import { HostPairing, pairingProof } from '../src/host-pairing.js';
import { IdentityStore, assertOwnedRemoteStorage } from '../src/identity-store.js';
import type { SafeLogger } from '../src/logging.js';
import { HostServerApi } from '../src/server-api.js';
import { HostServerConnection } from '../src/server-connection.js';
import { ServerCredentialStore } from '../src/server-credentials.js';
import { HostPluginRuntime } from '../src/service.js';
import type { AuthenticatedPeerChannel } from '../src/types.js';
import vectors from '../../../fixtures/pairing/v1/proof.json' with { type: 'json' };
const directories: string[] = [];
afterEach(async () => { vi.unstubAllGlobals(); vi.restoreAllMocks(); await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
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
    expect(await next.status()).toBeUndefined();
    expect(f.adopt).toHaveBeenCalledTimes(1);
    await next.discard();
    await expect(readFile(file)).rejects.toMatchObject({ code: 'ENOENT' });
});
it('removes host-pairing.json once completed credentials are adopted and stops terminal status polling/writes', async () => {
    const f = await setup();
    const pairing = f.create();
    await pairing.start();
    await pairing.status();
    const callsBeforeConfirm = f.fetcher.mock.calls.length;
    const completed = await pairing.confirm(f.session.sessionId, '00123456');
    expect(completed).toMatchObject({ state: 'completed', localSaved: true, canRetry: false });
    expect(f.adopt).toHaveBeenCalledTimes(1);
    const file = join(f.directory, 'host-pairing.json');
    await expect(readFile(file)).rejects.toMatchObject({ code: 'ENOENT' });
    const callsAfterConfirm = f.fetcher.mock.calls.length;
    expect(callsAfterConfirm).toBe(callsBeforeConfirm + 1);
    expect(await pairing.status()).toBeUndefined();
    expect(f.fetcher.mock.calls.length).toBe(callsAfterConfirm);

    // A failed terminal session stays readable once without rewriting disk or polling the server on repeated status checks.
    const failed = f.create();
    await failed.start();
    f.fail();
    expect(await failed.status()).toMatchObject({ state: 'failed', canRetry: false });
    const rawFailedBefore = await readFile(file, 'utf8');
    const callsAtFailed = f.fetcher.mock.calls.length;
    expect(await failed.status()).toMatchObject({ state: 'failed', canRetry: false });
    expect(f.fetcher.mock.calls.length).toBe(callsAtFailed);
    expect(await readFile(file, 'utf8')).toBe(rawFailedBefore);

    // Legacy 0.6.6 completed+localSaved files are cleaned up on load instead of lingering for 5 minutes.
    await writeFile(file, JSON.stringify({
        serverUrl: 'http://127.0.0.1:8081',
        deviceId: f.identity.deviceId,
        session: f.session,
        state: 'completed',
        localSaved: true,
    }));
    const callsBeforeLegacy = f.fetcher.mock.calls.length;
    expect(await f.create().status()).toBeUndefined();
    expect(f.fetcher.mock.calls.length).toBe(callsBeforeLegacy);
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
    f.fetcher.mockResolvedValueOnce(Response.json({ capabilities: {} }));
    f.fetcher.mockResolvedValueOnce(Response.json({ ...f.session, host: { ...f.host, identityKey: vectors.devicePublicKey } }));
    await expect(p.start()).rejects.toMatchObject({ code: 'PAIRING_IDENTITY_INVALID' });
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
    const identities = new IdentityStore({ directory: f.directory, role: 'host' });
    const recoveredIdentity = await identities.reset('Host');
    restored.bindIdentity(recoveredIdentity);
    await restored.loadStoredPolicy();
    expect(restored.pairingHostOnly()).toBe(true);
    await writeFile(join(f.directory, 'pairing-host-only.json'), '{"hostOnly":false}');
    await expect(assertOwnedRemoteStorage(f.directory)).rejects.toThrow();
    const loggedOutIdentity = await identities.reset('Host', { clearPairingPolicy: true });
    expect(loggedOutIdentity.deviceId).not.toBe(recoveredIdentity.deviceId);
    restored.bindIdentity(loggedOutIdentity);
    await restored.loadStoredPolicy();
    expect(restored.pairingHostOnly()).toBe(false);
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

it('preserves existing valid tokens and policy on same-account second pairing and rejects conflicts without polluting standard Hosts', async () => {
    await runScenarios([
        { name: 'existing device_pairing host', method: 'device_pairing' as const, accountKind: 'device_only' as const, pairingRestricted: true, inboundOnly: true, account: 'device:test' },
        { name: 'existing standard account host', method: 'account' as const, accountKind: 'standard' as const, pairingRestricted: false, inboundOnly: false, account: 'user@example.com' },
    ].map(row => ({
        name: row.name,
        run: async () => {
            const f = await setup();
            const store = new ServerCredentialStore(f.directory);
            const originalTokens = {
                accessToken: 'existing-access-token-0123456789',
                accessTokenExpiresAt: Date.now() + 600_000,
                refreshToken: 'existing-refresh-token-0123456789',
                refreshTokenExpiresAt: Date.now() + 86_400_000,
            };
            await store.save({
                serverUrl: 'http://127.0.0.1:8081',
                deviceId: f.identity.deviceId,
                authorizationMethod: row.method,
                account: row.account,
                accountKind: row.accountKind,
                pairingRestricted: row.pairingRestricted,
                inboundOnly: row.inboundOnly,
                ...originalTokens,
            });
            if (row.pairingRestricted) await store.restrictPairingHostOnly();

            const api = new HostServerApi('http://127.0.0.1:8081', store);
            api.bindIdentity(f.identity);
            await api.loadStoredPolicy();

            await api.adoptPairing({
                ...f.credentials,
                account: row.account,
                accountKind: row.accountKind,
                pairingRestricted: row.pairingRestricted,
                inboundOnly: row.inboundOnly,
                tokens: {
                    accessToken: 'new-pairing-access-token-9876543210',
                    accessTokenExpiresAt: Date.now() + 600_000,
                    refreshToken: 'new-pairing-refresh-token-9876543210',
                    refreshTokenExpiresAt: Date.now() + 86_400_000,
                },
            });

            expect(api.pairingHostOnly()).toBe(row.pairingRestricted);
            expect(api.currentAuthorization()).toEqual({ method: row.method, account: row.account });
            expect(await store.load(api.baseUrl, f.identity.deviceId)).toMatchObject({
                authorizationMethod: row.method,
                account: row.account,
                ...originalTokens,
            });
            if (!row.pairingRestricted) {
                await expect(readFile(join(f.directory, 'pairing-host-only.json'))).rejects.toMatchObject({ code: 'ENOENT' });
            }

            // Account conflict and invalid tokens must fail before touching pairing-host-only.json.
            await expect(api.adoptPairing({
                ...f.credentials,
                account: 'other-account@example.com',
                pairingRestricted: true,
                inboundOnly: true,
            })).rejects.toMatchObject({ code: 'PAIRING_ACCOUNT_CONFLICT' });
            await expect(api.adoptPairing({
                ...f.credentials,
                account: row.account,
                pairingRestricted: true,
                inboundOnly: true,
                tokens: { ...f.credentials.tokens, accessToken: 'short' },
            })).rejects.toMatchObject({ code: 'INVALID_MESSAGE' });
            expect(api.pairingHostOnly()).toBe(row.pairingRestricted);
            if (!row.pairingRestricted) {
                await expect(readFile(join(f.directory, 'pairing-host-only.json'))).rejects.toMatchObject({ code: 'ENOENT' });
            }
            expect(await store.load(api.baseUrl, f.identity.deviceId)).toMatchObject({
                authorizationMethod: row.method,
                account: row.account,
                ...originalTokens,
            });
            if (!row.pairingRestricted) {
                await store.save({
                    serverUrl: 'http://127.0.0.1:8081',
                    deviceId: f.identity.deviceId,
                    authorizationMethod: 'account',
                    account: row.account,
                    accountKind: 'standard',
                    pairingRestricted: false,
                    inboundOnly: false,
                    accessToken: 'expiring-access-token-0123456789',
                    accessTokenExpiresAt: Date.now() + 10_000,
                    refreshToken: 'expiring-refresh-token-0123456789',
                    refreshTokenExpiresAt: Date.now() + 10_000,
                });
                const refreshedTokens = {
                    accessToken: 'refreshed-pairing-access-token-0123',
                    accessTokenExpiresAt: Date.now() + 600_000,
                    refreshToken: 'refreshed-pairing-refresh-token-0123',
                    refreshTokenExpiresAt: Date.now() + 86_400_000,
                };
                await api.adoptPairing({
                    ...f.credentials,
                    account: row.account,
                    accountKind: 'standard',
                    pairingRestricted: false,
                    inboundOnly: false,
                    tokens: refreshedTokens,
                });
                expect(api.pairingHostOnly()).toBe(false);
                expect(api.currentAuthorization()).toEqual({ method: 'account', account: row.account });
                expect(await store.load(api.baseUrl, f.identity.deviceId)).toMatchObject({
                    authorizationMethod: 'account',
                    account: row.account,
                    ...refreshedTokens,
                });
                await expect(readFile(join(f.directory, 'pairing-host-only.json'))).rejects.toMatchObject({ code: 'ENOENT' });
            }
            api.close();
        },
    })));
});

it('supports pairing a second phone after completion and persists terminal failureReason across status reads', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'remote-pairing-multi-'));
    directories.push(directory);
    const identity = await new IdentityStore({ directory }).loadOrCreate('Host');
    const host = { deviceId: identity.deviceId, name: identity.name, role: 'host' as const, platform: 'desktop', identityKey: identity.publicKey };
    const phone1 = { ...host, deviceId: 'phone-1', name: 'Phone 1', role: 'client' as const, identityKey: generateKeyPair().publicKey };
    const phone2 = { ...host, deviceId: 'phone-2', name: 'Phone 2', role: 'client' as const, identityKey: generateKeyPair().publicKey };
    let sessionIndex = 0;
    let currentMobile = phone1;
    let currentState = 'claimed';
    let failureReason: string | null = null;
    const adopted: unknown[] = [];

    const createSession = () => {
        sessionIndex += 1;
        return {
            v: 1 as const,
            sessionId: `019a0000-0000-7000-8000-00000000000${sessionIndex}`,
            expiresAt: Date.now() + 180_000,
            serverPublicKey: generateKeyPair().publicKey,
            scanSecret: generateKeyPair().publicKey,
            host,
        };
    };
    let activeSession = createSession();
    const credentials = {
        account: 'device:test',
        accountKind: 'device_only' as const,
        device: host,
        inboundOnly: true,
        pairingRestricted: true,
        tokens: {
            accessToken: 'access-token-0123456789',
            accessTokenExpiresAt: Date.now() + 600_000,
            refreshToken: 'refresh-token-0123456789',
            refreshTokenExpiresAt: Date.now() + 86_400_000,
        },
    };

    const fetcher = vi.fn<typeof fetch>(async url => {
        const path = new URL(String(url)).pathname;
        if (path.endsWith('/oauth/providers')) return Response.json({ capabilities: { devicePairingQr: 'fragment-ticket-v1' } });
        if (path.endsWith('/sessions')) {
            activeSession = createSession();
            return Response.json(activeSession);
        }
        if (path.endsWith('/confirm')) {
            currentState = failureReason ? 'failed' : 'completed';
        }
        return Response.json({
            v: 1,
            sessionId: activeSession.sessionId,
            state: currentState,
            expiresAt: activeSession.expiresAt,
            recoverUntil: activeSession.expiresAt + 300_000,
            failureReason,
            attemptConsumed: currentState === 'completed' || currentState === 'failed',
            submissionId: null,
            host,
            mobile: currentMobile,
            credentials: currentState === 'completed' ? credentials : null,
        });
    });

    const pairing = new HostPairing('http://127.0.0.1:8081', directory, identity, host, async value => { adopted.push(value); }, fetcher);
    const first = await pairing.start();
    await pairing.status();
    await pairing.confirm(first.sessionId, '00123456');

    currentMobile = phone2;
    currentState = 'claimed';
    const second = await pairing.start();
    const claimedSecond = await pairing.status();
    expect(claimedSecond?.mobile?.deviceId).toBe('phone-2');
    const completedSecond = await pairing.confirm(second.sessionId, '65432100');
    expect(completedSecond).toMatchObject({ state: 'completed', localSaved: true, mobile: { deviceId: 'phone-2' } });
    expect(adopted).toHaveLength(2);
    pairing.close();

    await runScenarios(['verification_failed', 'PAIRING_ACCOUNT_CONFLICT', 'HOST_DEVICE_LIMIT_REACHED'].map(reason => ({
        name: reason,
        run: async () => {
            failureReason = reason;
            currentState = 'claimed';
            const subDir = await mkdtemp(join(tmpdir(), 'remote-pairing-fail-'));
            directories.push(subDir);
            const subIdentity = await new IdentityStore({ directory: subDir }).loadOrCreate('Host');
            const subHost = { ...host, deviceId: subIdentity.deviceId, identityKey: subIdentity.publicKey };
            let subSession = createSession();
            const subFetcher = vi.fn<typeof fetch>(async url => {
                const path = new URL(String(url)).pathname;
                if (path.endsWith('/oauth/providers')) return Response.json({ capabilities: { devicePairingQr: 'fragment-ticket-v1' } });
                if (path.endsWith('/sessions')) {
                    subSession = { ...createSession(), host: subHost };
                    return Response.json(subSession);
                }
                if (path.endsWith('/confirm')) currentState = 'failed';
                return Response.json({
                    v: 1,
                    sessionId: subSession.sessionId,
                    state: currentState,
                    expiresAt: subSession.expiresAt,
                    recoverUntil: subSession.expiresAt + 300_000,
                    failureReason,
                    attemptConsumed: currentState === 'failed',
                    submissionId: null,
                    host: subHost,
                    mobile: phone1,
                    credentials: null,
                });
            });
            const failPairing = new HostPairing('http://127.0.0.1:8081', subDir, subIdentity, subHost, async () => { }, subFetcher);
            const started = await failPairing.start();
            await failPairing.status();
            const failed = await failPairing.confirm(started.sessionId, '00000001');
            expect(failed).toMatchObject({ state: 'failed', failureReason: reason, localSaved: false });
            await assertOwnedRemoteStorage(subDir);
            const callsAtFailure = subFetcher.mock.calls.length;
            expect(await failPairing.status()).toMatchObject({ state: 'failed', failureReason: reason });
            failPairing.close();
            const reopened = new HostPairing('http://127.0.0.1:8081', subDir, subIdentity, subHost, async () => { }, subFetcher);
            expect(await reopened.status()).toMatchObject({ state: 'failed', failureReason: reason });
            expect(subFetcher.mock.calls.length).toBe(callsAtFailure);
            reopened.close();
        },
    })));
});

it('resumes offline Hosts on first pairing adoption and preserves active tunnels on already-online second pairing', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'remote-pairing-runtime-'));
    directories.push(directory);
    const serverUrl = 'http://127.0.0.1:8081';
    const config = resolveConfig({
        serverUrl,
        httpServerAllowlist: ['127.0.0.1'],
        codex: { enabled: false },
        acp: { enabled: false },
        deviceName: 'TestHost',
    });
    const identities = new IdentityStore({ directory, role: 'host' });
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as SafeLogger;
    let serverOnline = false;
    vi.spyOn(HostServerConnection.prototype, 'start').mockImplementation(() => undefined);
    vi.spyOn(HostServerConnection.prototype, 'isOnline').mockImplementation(() => serverOnline);
    const reconnectSpy = vi.spyOn(HostServerConnection.prototype, 'reconnect').mockImplementation(() => undefined);
    const resumeSpy = vi.spyOn(HostServerConnection.prototype, 'resume').mockImplementation(() => undefined);

    const identity = await identities.loadOrCreate('TestHost');
    const host = { deviceId: identity.deviceId, name: identity.name, role: 'host' as const, platform: process.platform, identityKey: identity.publicKey };
    const phone1Key = generateKeyPair().publicKey;
    const phone2Key = generateKeyPair().publicKey;
    let sessionSeq = 0;
    let activeSessionId = '';
    let activeExpiresAt = Date.now() + 180_000;
    let activeMobile = { ...host, deviceId: 'phone-1', name: 'Phone 1', role: 'client' as const, identityKey: phone1Key };
    let state = 'claimed';

    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
        const path = new URL(String(input)).pathname;
        if (path.endsWith('/oauth/providers')) return Response.json({ capabilities: { devicePairingQr: 'fragment-ticket-v1' } });
        if (path.endsWith('/sessions')) {
            sessionSeq += 1;
            activeSessionId = `019a0000-0000-7000-8000-00000000001${sessionSeq}`;
            activeExpiresAt = Date.now() + 180_000;
            return Response.json({ v: 1, sessionId: activeSessionId, expiresAt: activeExpiresAt, serverPublicKey: generateKeyPair().publicKey, scanSecret: generateKeyPair().publicKey, host });
        }
        if (path.endsWith('/confirm')) state = 'completed';
        return Response.json({
            v: 1,
            sessionId: activeSessionId,
            state,
            expiresAt: activeExpiresAt,
            recoverUntil: activeExpiresAt + 300_000,
            failureReason: null,
            attemptConsumed: state === 'completed',
            submissionId: null,
            host,
            mobile: activeMobile,
            credentials: state === 'completed' ? {
                account: 'device:runtime-account',
                accountKind: 'device_only',
                device: host,
                inboundOnly: true,
                pairingRestricted: true,
                tokens: {
                    accessToken: 'runtime-access-token-0123456789',
                    accessTokenExpiresAt: Date.now() + 600_000,
                    refreshToken: 'runtime-refresh-token-0123456789',
                    refreshTokenExpiresAt: Date.now() + 86_400_000,
                },
            } : null,
        });
    }));

    const runtime = new HostPluginRuntime(config, identities, logger);
    await runtime.start();

    const makeChannel = (connectionId: string, peerDeviceId: string, peerIdentityKey: string): AuthenticatedPeerChannel => ({
        security: { protocol: 'Noise_IK_25519_ChaChaPoly_SHA256', connectionId, membershipId: 'member-1' },
        peerDeviceId,
        peerIdentityKey,
        mode: 'LAN',
        send: vi.fn(async () => undefined),
        close: vi.fn(async () => undefined),
        onMessage: vi.fn(() => () => undefined),
    });

    try {
        // Offline first pairing calls resume(), never reconnect().
        const first = await runtime.pairingControl('start', {});
        await runtime.pairingControl('status', {});
        await runtime.pairingControl('confirm', { sessionId: first!.sessionId, verificationCode: '00123456' });
        expect(resumeSpy).toHaveBeenCalledTimes(1);
        expect(reconnectSpy).not.toHaveBeenCalled();

        // Phone 1 connects and stays online.
        serverOnline = true;
        await identities.trustPeer({ deviceId: 'phone-1', name: 'Phone 1', platform: 'android', publicKey: phone1Key, membershipId: 'member-1' });
        const channel1 = makeChannel('conn-1', 'phone-1', phone1Key);
        await runtime.acceptAuthenticatedPeer(channel1);

        // Online second pairing neither reconnects nor resumes, keeping Phone 1 connected.
        activeMobile = { ...host, deviceId: 'phone-2', name: 'Phone 2', role: 'client' as const, identityKey: phone2Key };
        state = 'claimed';
        const second = await runtime.pairingControl('start', {});
        await runtime.pairingControl('status', {});
        await runtime.pairingControl('confirm', { sessionId: second!.sessionId, verificationCode: '65432100' });
        expect(reconnectSpy).not.toHaveBeenCalled();
        expect(resumeSpy).toHaveBeenCalledTimes(1);
        expect(channel1.close).not.toHaveBeenCalled();

        await identities.trustPeer({ deviceId: 'phone-2', name: 'Phone 2', platform: 'ios', publicKey: phone2Key, membershipId: 'member-1' });
        const channel2 = makeChannel('conn-2', 'phone-2', phone2Key);
        await runtime.acceptAuthenticatedPeer(channel2);
        expect(identities.listTrustedPeers().map(peer => peer.deviceId).sort()).toEqual(['phone-1', 'phone-2']);
        expect(runtime.hostStatus().connectedClients.map(client => client.deviceId).sort()).toEqual(['phone-1', 'phone-2']);
    } finally {
        await runtime.close();
    }
});
