/** Isolated C# API/Gateway integration. No production URL or manual-test data. */
import assert from 'node:assert/strict';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { HostPairing, pairingProof } from '../packages/plugin/src/host-pairing.js';
import { IdentityStore } from '../packages/plugin/src/identity-store.js';
import { HostServerApi, ClientServerApi } from '../packages/plugin/src/server-api.js';
import { ServerCredentialStore } from '../packages/plugin/src/server-credentials.js';
import { pairingStatusSchema } from '../packages/plugin/src/pairing-contract.js';
import { HostServerConnection, type WebSocketFactory } from '../packages/plugin/src/server-connection.js';
import { ConnectionController } from '../packages/plugin/src/connection-controller.js';
import { RpcRouter } from '../packages/plugin/src/rpc-router.js';
import { SafeLogger } from '../packages/plugin/src/logging.js';
import { resolveConfig } from '../packages/plugin/src/config.js';
import { AdaptiveTransport } from '../packages/webrtc/src/adaptive-transport.js';
import { ClientSecureTransport } from '../packages/plugin/src/client-secure-transport.js';
import { RemoteClientCore } from '../packages/client-core/src/index.js';
const directory = await mkdtemp(join(tmpdir(), 'remote-csharp-pairing-'));
const serverRoot = resolve(process.env.DSH_PAIRING_SERVER_ROOT ?? '../deepseek-harness-server');
const apiDll = join(serverRoot, 'http-dotnet/bin/Release/net10.0/Dsh.Http.dll');
const gatewayDll = join(serverRoot, 'gateway-dotnet/bin/Release/net10.0/Dsh.Gateway.dll');
const children: ChildProcess[] = [];
let hostConnection: HostServerConnection | undefined;
let client: RemoteClientCore | undefined;
async function port(): Promise<number> {
    const server = createServer();
    await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
    const address = server.address();
    assert(address && typeof address !== 'string');
    const value = address.port;
    await new Promise<void>(done => server.close(() => done()));
    return value;
}
async function wait(test: () => boolean | Promise<boolean>, label: string): Promise<void> {
    const end = Date.now() + 20000;
    while (Date.now() < end) {
        if (await test())
            return;
        await new Promise(done => setTimeout(done, 100));
    }
    throw new Error('Timed out: ' + label);
}
const apiUrl = `http://127.0.0.1:${await port()}`, gatewayUrl = `http://127.0.0.1:${await port()}`;
const env = { ...process.env, DATABASE_URL: 'sqlite:///' + join(directory, 'core.db'), RUNTIME_DATABASE_URL: '', REMOTE_SECRET_KEY: randomBytes(32).toString('hex'),
    REMOTE_PUBLIC_URL: apiUrl, DSH_API_URL: apiUrl, DSH_GATEWAY_URL: gatewayUrl, DSH_GATEWAY_STATE_MODE: 'http', DSH_GATEWAY_REDIS_URL: '', DSH_DEV: '1', DSH_CLOUD_ENABLED: '0', RELAY_OFFLOAD_ENABLED: '0', PAIRING_CREATE_RATE_LIMIT: '100/min', PAIRING_REQUEST_RATE_LIMIT: '1000/min' };
function start(dll: string, url: string): void { children.push(spawn('dotnet', [dll], { env: { ...env, ASPNETCORE_URLS: url }, stdio: 'ignore' })); }
try {
    execFileSync('dotnet', [apiDll, '--migrate'], { env, stdio: 'pipe' });
    start(apiDll, apiUrl);
    start(gatewayDll, gatewayUrl);
    for (const url of [apiUrl, gatewayUrl])
        await wait(async () => { try {
            return (await fetch(url + '/health')).ok;
        }
        catch {
            return false;
        } }, 'isolated services');
    const identities = new IdentityStore({ directory: join(directory, 'host') });
    const host = await identities.loadOrCreate('Test Host');
    const mobileStore = new IdentityStore({ directory: join(directory, 'phone') });
    const phone = await mobileStore.loadOrCreate('Simulated phone');
    const store = new ServerCredentialStore(identities.directory);
    const api = new HostServerApi(apiUrl, store);
    api.bindIdentity(host);
    const descriptor = { deviceId: host.deviceId, name: host.name, role: 'host', platform: 'desktop', identityKey: host.publicKey };
    const pairing = new HostPairing(apiUrl, identities.directory, host, descriptor, result => api.adoptPairing(result));
    const created = await pairing.start();
    const shortQr = new URL(created.qrPayload!);
    assert.equal(shortQr.origin, apiUrl);
    assert.equal(shortQr.pathname, '/pair');
    assert.match(shortQr.hash, /^#v1\.[A-Za-z0-9_-]{43}$/);
    const resolution = await fetch(apiUrl + '/api/v1/device-pairing/resolve', { method: 'POST',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ticket: shortQr.hash.slice(4) }) });
    assert.equal(resolution.status, 200);
    const qr = await resolution.json() as { sessionId: string; scanSecret: string; serverPublicKey: string; host: { identityKey: string } };
    assert.equal(qr.host.identityKey, host.publicKey);
    async function mobile(action: string, body: unknown): Promise<unknown> {
        const path = `/api/v1/device-pairing/sessions/${qr.sessionId}/${action}`, raw = JSON.stringify(body);
        const response = await fetch(apiUrl + path, { method: 'POST', body: raw, headers: { 'Content-Type': 'application/json', 'X-DSH-Pairing-Proof': pairingProof(phone.privateKey, qr.serverPublicKey, qr.sessionId, path, raw, 'mobile') } });
        assert.equal(response.status, 200);
        return response.json();
    }
    const claim = await mobile('claim', { scanSecret: qr.scanSecret, device: { deviceId: phone.deviceId, name: phone.name, role: 'client', platform: 'android', identityKey: phone.publicKey } }) as {
        verificationCode: string;
    };
    const pending = await pairing.status();
    assert.equal(pending?.state, 'claimed');
    assert.equal(await store.load(apiUrl, host.deviceId), undefined);
    assert.equal(JSON.stringify(pending).includes(claim.verificationCode), false);
    assert.equal((await fetch(apiUrl + '/api/v1/devices/' + host.deviceId)).status, 401);
    // Dummy fixture only: never approve a real user/device from this script.
    assert.equal((await pairing.confirm(qr.sessionId, claim.verificationCode)).state, 'completed');
    assert.equal(api.pairingHostOnly(), true);
    const resumed = new HostPairing(apiUrl, identities.directory, host, descriptor, result => api.adoptPairing(result));
    assert.equal((await resumed.status())?.localSaved, true);
    const result = pairingStatusSchema.parse(await mobile('mobile/status', {}));
    assert(result.credentials);
    assert.equal(result.credentials.device.deviceId, phone.deviceId);
    const credentials = new ServerCredentialStore(mobileStore.directory);
    await credentials.save({ serverUrl: apiUrl, deviceId: phone.deviceId, authorizationMethod: 'device_pairing', account: result.credentials.account, ...result.credentials.tokens });
    const phoneApi = new ClientServerApi(apiUrl, credentials);
    phoneApi.bindIdentity(phone);
    const target = await phoneApi.deviceFor(host.deviceId);
    assert.equal(target.identityKey, host.publicKey);
    const trusted = await mobileStore.trustPeer({ deviceId: host.deviceId, name: host.name, platform: 'desktop', publicKey: host.publicKey, membershipId: target.membershipId });
    const logger = new SafeLogger({ debug() { }, info() { }, warn() { }, error() { } });
    const connections = new ConnectionController(identities, () => new RpcRouter(), logger);
    // The fixture has separate ports; production routes both through one origin.
    const socketFactory = (url => new WebSocket(url.replace(apiUrl.replace('http:', 'ws:'), gatewayUrl.replace('http:', 'ws:')))) as WebSocketFactory;
    hostConnection = new HostServerConnection(resolveConfig({ serverUrl: apiUrl, forceRelay: true }), host, identities, api, connections, logger, socketFactory);
    hostConnection.start();
    await wait(() => hostConnection!.isOnline(), 'Host hello');
    const transport = new AdaptiveTransport(gatewayUrl.replace('http:', 'ws:') + '/ws/v1/connect', { role: 'client', deviceId: phone.deviceId, accessToken: result.credentials.tokens.accessToken, targetDeviceId: host.deviceId, forceRelay: true, preferredTransports: ['relay'], handshakeTimeoutMs: 10000 });
    client = new RemoteClientCore(new ClientSecureTransport(transport, phone, trusted), 10000);
    await client.connect();
    assert(await client.rpc('harness.transport.describe', {}));
    console.log('PASS: C# API/Gateway + Remote QR pairing, separate credentials, restart recovery, Host hello and Noise/Relay encrypted RPC');
    const revoke = await fetch(apiUrl + '/api/v1/device-memberships/' + host.deviceId, { method: 'DELETE', headers: { Authorization: 'Bearer ' + result.credentials.tokens.accessToken } });
    assert.equal(revoke.status, 200);
    assert.equal((await phoneApi.listDevices()).length, 0);
    await assert.rejects(() => phoneApi.deviceFor(host.deviceId));
    console.log('PASS: scoped membership revocation denies further discovery/access');
    await connections.close();
    api.close();
    phoneApi.close();
    pairing.close();
    resumed.close();
}
finally {
    await client?.close().catch(() => undefined);
    await hostConnection?.stop().catch(() => undefined);
    for (const child of children.reverse())
        if (child.exitCode === null) {
            child.kill('SIGTERM');
            await Promise.race([new Promise<void>(done => child.once('exit', () => done())), new Promise<void>(done => setTimeout(() => { child.kill('SIGKILL'); done(); }, 3000))]);
        }
    await rm(directory, { recursive: true, force: true });
}
