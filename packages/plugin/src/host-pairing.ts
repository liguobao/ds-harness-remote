import { createHash, createHmac, createPrivateKey, createPublicKey, diffieHellman, hkdfSync, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { join } from 'node:path';
import { rm } from 'node:fs/promises';
import { z } from 'zod';
import { normalizeServerUrl } from './config.js';
import { atomicWritePrivate, readPrivateJson } from './server-credentials.js';
import { ServerApiError, type FetchImplementation } from './server-api.js';
import type { HostIdentity } from './identity-store.js';
import { pairingCreatedSchema, pairingStatusSchema, savedPairingSchema, type PairingCredentials, type HostPairingView } from './pairing-contract.js';
import { uuidV7 } from './ids.js';
const root = '/api/v1/device-pairing/sessions';
type Saved = z.infer<typeof savedPairingSchema>;
const active = new Set(['created', 'claimed', 'approved']);
function rawKey(text: string): Buffer {
    const bytes = Buffer.from(text, 'base64url');
    if (bytes.length !== 32 || bytes.toString('base64url') !== text)
        throw new ServerApiError('PAIRING_IDENTITY_INVALID', 'Invalid pairing key.', false);
    return bytes;
}
export function pairingProof(privateKey: string, serverKey: string, id: string, path: string, raw: string, side: 'host' | 'mobile' = 'host'): string {
    const local = createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b656e04220420', 'hex'), rawKey(privateKey)]), format: 'der', type: 'pkcs8' });
    const peer = createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b656e032100', 'hex'), rawKey(serverKey)]), format: 'der', type: 'spki' });
    const shared = diffieHellman({ privateKey: local, publicKey: peer });
    const key = Buffer.from(hkdfSync('sha256', shared, Buffer.from(id), Buffer.from('dsh-pairing-v1/' + side), 32));
    try {
        return createHmac('sha256', key).update(`POST\n${path}\n${createHash('sha256').update(raw).digest('hex')}`).digest('base64url');
    }
    finally {
        shared.fill(0);
        key.fill(0);
    }
}
export const fullFingerprint = (key: string): string => createHash('sha256').update(rawKey(key)).digest('hex');
/** Host-only local workflow. No phone code retrieval, model tools or tunnel RPC. */
export class HostPairing {
    private readonly path: string;
    private readonly serverUrl: string;
    private readonly lifetime = new AbortController();
    private queue: Promise<unknown> = Promise.resolve();
    constructor(serverUrl: string, directory: string, private readonly identity: HostIdentity, private readonly descriptor: Record<string, unknown>, private readonly adopt: (value: PairingCredentials) => Promise<void>, private readonly fetcher: FetchImplementation = fetch, httpServerAllowlist: readonly string[] = []) {
        this.serverUrl = normalizeServerUrl(serverUrl, httpServerAllowlist);
        this.path = join(directory, 'host-pairing.json');
    }
    close(): void { this.lifetime.abort(); }
    async discard(): Promise<void> { this.close(); await this.queue.catch(() => undefined); await rm(this.path, { force: true }); }
    private serial<T>(fn: () => Promise<T>): Promise<T> { const task = this.queue.catch(() => undefined).then(fn); this.queue = task; return task; }
    start(): Promise<HostPairingView> {
        return this.serial(async () => {
            const old = await this.load();
            if (old) {
                const status = await this.poll(old);
                if (active.has(status.state))
                    await this.send(old, 'host/cancel', '{}');
            }
            const discovery = await this.request('/api/v1/auth/oauth/providers', undefined, undefined, 'GET') as { capabilities?: { devicePairingQr?: unknown } };
            const compactQr = discovery.capabilities?.devicePairingQr === 'fragment-ticket-v1';
            const session = pairingCreatedSchema.parse(await this.request(root, JSON.stringify({ v: 1, device: this.descriptor })));
            this.assertHost(session.host);
            if (session.expiresAt <= Date.now() || session.expiresAt > Date.now() + 240000)
                throw new ServerApiError('INVALID_MESSAGE', 'Invalid pairing expiry.', false);
            const saved: Saved = { serverUrl: this.serverUrl, deviceId: this.identity.deviceId, session, state: 'created', localSaved: false, ...(compactQr ? { qrFormat: 'fragment-ticket-v1' as const } : {}) };
            await this.save(saved);
            return this.view(saved);
        });
    }
    status(): Promise<HostPairingView | undefined> { return this.serial(async () => { const saved = await this.load(); return saved ? this.poll(saved) : undefined; }); }
    confirm(id: string, code?: string): Promise<HostPairingView> {
        return this.serial(async () => {
            const saved = await this.requireSession(id);
            let raw: string;
            if (saved.submission !== undefined) {
                if (code !== undefined)
                    throw new ServerApiError('PAIRING_ATTEMPT_USED', 'Recover the original submission without changing the code.', false);
                raw = this.crypt(saved.submission, id, false);
            }
            else {
                if (saved.state !== 'claimed' || typeof code !== 'string' || !/^[0-9]{8}$/.test(code))
                    throw new ServerApiError('INVALID_MESSAGE', 'Confirm on the phone and enter 8 digits.', false);
                raw = JSON.stringify({ submissionId: uuidV7(), verificationCode: code });
                saved.submission = this.crypt(raw, id, true);
                await this.save(saved);
            }
            return this.accept(saved, await this.send(saved, 'host/confirm', raw));
        });
    }
    cancel(id: string): Promise<HostPairingView> { return this.serial(async () => { const s = await this.requireSession(id); return this.accept(s, await this.send(s, 'host/cancel', '{}')); }); }
    private async load(): Promise<Saved | undefined> {
        const value = await readPrivateJson(this.path);
        if (value === undefined)
            return undefined;
        const s = savedPairingSchema.parse(value);
        if (s.serverUrl !== this.serverUrl || s.deviceId !== this.identity.deviceId)
            throw new ServerApiError('PAIRING_IDENTITY_INVALID', 'Pairing belongs to another identity.', false);
        if (s.session.expiresAt + 300000 <= Date.now()) {
            await rm(this.path, { force: true });
            return undefined;
        }
        return s;
    }
    private async requireSession(id: string): Promise<Saved> {
        const s = await this.load();
        if (!s || s.session.sessionId !== id)
            throw new ServerApiError('PAIRING_CLOSED', 'This pairing was replaced or expired.', false);
        return s;
    }
    private save(s: Saved): Promise<void> { return atomicWritePrivate(this.path, JSON.stringify(s)); }
    private async poll(s: Saved): Promise<HostPairingView> {
        try {
            return await this.accept(s, await this.send(s, 'host/status', '{}'));
        }
        catch (e) {
            if (!(e instanceof ServerApiError) || e.status !== 404)
                throw e;
            s.state = 'expired';
            delete s.submission;
            await this.save(s);
            return this.view(s);
        }
    }
    private assertHost(d: {
        deviceId: string;
        role: string;
        identityKey: string;
    }): void {
        if (d.deviceId !== this.identity.deviceId || d.role !== 'host' || d.identityKey !== this.identity.publicKey)
            throw new ServerApiError('PAIRING_IDENTITY_INVALID', 'Host identity changed.', false);
    }
    private async accept(s: Saved, value: unknown): Promise<HostPairingView> {
        this.lifetime.signal.throwIfAborted();
        const r = pairingStatusSchema.parse(value);
        if (r.sessionId !== s.session.sessionId || r.expiresAt !== s.session.expiresAt)
            throw new ServerApiError('INVALID_MESSAGE', 'Pairing session changed.', false);
        this.assertHost(r.host);
        if (r.mobile) {
            if (r.mobile.role !== 'client' || r.mobile.deviceId === this.identity.deviceId || r.mobile.identityKey === this.identity.publicKey
                || s.mobile && (s.mobile.deviceId !== r.mobile.deviceId || s.mobile.identityKey !== r.mobile.identityKey))
                throw new ServerApiError('PAIRING_DEVICE_CONFLICT', 'Phone identity changed.', false);
            s.mobile = r.mobile;
        }
        if (r.state === 'completed') {
            if (!r.credentials)
                throw new ServerApiError('INVALID_MESSAGE', 'Missing Host credentials.', false);
            this.assertHost(r.credentials.device);
            if (r.credentials.pairingRestricted && !r.credentials.inboundOnly)
                throw new ServerApiError('DEVICE_SCOPE_REQUIRED', 'Paired Host must remain inbound only.', false);
            if (!s.localSaved) {
                await this.adopt(r.credentials);
                s.localSaved = true;
            }
        }
        s.state = r.state;
        if (!active.has(s.state))
            delete s.submission;
        await this.save(s);
        return this.view(s, r.failureReason);
    }
    private view(s: Saved, reason?: string | null): HostPairingView {
        return { sessionId: s.session.sessionId, state: s.state, expiresAt: s.session.expiresAt, serverUrl: this.serverUrl, hostFingerprint: fullFingerprint(this.identity.publicKey),
            ...(s.state === 'created' ? { qrPayload: s.qrFormat === 'fragment-ticket-v1' ? `${this.serverUrl}/pair#v1.${s.session.scanSecret}` : JSON.stringify({ type: 'dsh.remote.pairing', ...s.session, serverUrl: this.serverUrl }) } : {}),
            ...(s.mobile ? { mobile: { deviceId: s.mobile.deviceId, name: s.mobile.name, fingerprint: fullFingerprint(s.mobile.identityKey) } } : {}),
            ...(reason ? { failureReason: reason } : {}), canRetry: s.submission !== undefined && active.has(s.state), localSaved: s.localSaved };
    }
    private send(s: Saved, action: string, raw: string): Promise<unknown> {
        const path = `${root}/${s.session.sessionId}/${action}`;
        return this.request(path, raw, pairingProof(this.identity.privateKey, s.session.serverPublicKey, s.session.sessionId, path, raw));
    }
    private async request(path: string, body: string | undefined, proof?: string, method = 'POST'): Promise<unknown> {
        try {
            const response = await this.fetcher(this.serverUrl + path, { method, redirect: 'error', headers: { 'Content-Type': 'application/json', ...(proof ? { 'X-DSH-Pairing-Proof': proof } : {}) }, body, signal: AbortSignal.any([this.lifetime.signal, AbortSignal.timeout(10000)]) });
            if (response.status === 404 && method === 'GET' && path === '/api/v1/auth/oauth/providers') return {};
            if (response.status === 404 && path === root)
                throw new ServerApiError('PAIRING_UNSUPPORTED', 'This Server does not support pairing.', false);
            const text = await response.text();
            if (text.length > 32768)
                throw new Error('oversized response');
            const value = JSON.parse(text) as {
                error?: {
                    code?: string;
                };
            };
            if (!response.ok) {
                const code = value.error?.code;
                throw new ServerApiError(typeof code === 'string' && /^[A-Z_]{1,80}$/.test(code) ? code : 'PAIRING_REQUEST_FAILED', 'Pairing failed; recover the original submission if sent.', response.status >= 500 || response.status === 429, response.status);
            }
            return value;
        }
        catch (e) {
            if (e instanceof ServerApiError)
                throw e;
            throw new ServerApiError('PAIRING_CONNECTION_FAILED', 'Pairing result is unknown. Recover the original submission.', true);
        }
    }
    private crypt(value: string, id: string, encrypt: boolean): string {
        const key = createHash('sha256').update('dsh-pairing-host-submission-v1\0').update(rawKey(this.identity.privateKey)).digest();
        try {
            if (encrypt) {
                const iv = randomBytes(12);
                const c = createCipheriv('aes-256-gcm', key, iv);
                c.setAAD(Buffer.from(id));
                const data = Buffer.concat([c.update(value, 'utf8'), c.final()]);
                return Buffer.concat([iv, c.getAuthTag(), data]).toString('base64url');
            }
            const b = Buffer.from(value, 'base64url');
            const c = createDecipheriv('aes-256-gcm', key, b.subarray(0, 12));
            c.setAAD(Buffer.from(id));
            c.setAuthTag(b.subarray(12, 28));
            return Buffer.concat([c.update(b.subarray(28)), c.final()]).toString('utf8');
        }
        finally {
            key.fill(0);
        }
    }
}
