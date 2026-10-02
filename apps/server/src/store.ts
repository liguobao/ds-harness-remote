import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { accountDeviceDescriptorSchema, type AccountDeviceDescriptor } from '@dsh-remote/protocol'
import { z } from 'zod'

export class ApiError extends Error {
  constructor(readonly code: string, readonly status = 400) { super(code) }
}
export const hash = (value: string): string => createHash('sha256').update(value).digest('hex')
export const secret = (): string => randomBytes(32).toString('base64url')
export const equal = (left: string, right: string): boolean => timingSafeEqual(Buffer.from(hash(left)), Buffer.from(hash(right)))
const tokenSchema = z.object({ kind: z.enum(['access', 'refresh']), deviceId: z.string(), expires: z.number(), used: z.boolean() })
const savedDeviceSchema = z.object({ descriptor: accountDeviceDescriptorSchema, revoked: z.boolean(), lastSeenAt: z.number() })
const stateSchema = z.object({ version: z.literal(1), account: z.string(), salt: z.string(), verifier: z.string(), devices: z.record(savedDeviceSchema), tokens: z.record(tokenSchema) })
type SavedDevice = z.infer<typeof savedDeviceSchema>

/** Single-process store. Only token digests and public identities reach disk. */
export class Store {
  private state: z.infer<typeof stateSchema>
  onInvalidate: (id: string) => void = () => {}
  constructor(private readonly file: string, readonly account: string, password: string) {
    const previous = existsSync(file) ? stateSchema.parse(JSON.parse(readFileSync(file, 'utf8'))) : undefined
    const salt = previous?.salt ?? secret()
    const verifier = scryptSync(password, salt, 32).toString('hex')
    this.state = previous ?? { version: 1, account, salt, verifier, devices: {}, tokens: {} }
    if (this.state.account !== account) this.state.devices = {}
    if (this.state.account !== account || !equal(this.state.verifier, verifier)) this.state.tokens = {}
    Object.assign(this.state, { account, verifier })
    this.save()
  }
  private save(): void {
    mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 })
    const tmp = `${this.file}.tmp`
    writeFileSync(tmp, JSON.stringify(this.state), { mode: 0o600 })
    renameSync(tmp, this.file)
  }
  get(id: string): SavedDevice {
    const d = Object.hasOwn(this.state.devices, id) ? this.state.devices[id] : undefined
    if (!d) throw new ApiError('DEVICE_NOT_FOUND', 404)
    if (d.revoked) throw new ApiError('DEVICE_REVOKED', 403)
    return d
  }
  list(): SavedDevice[] { return Object.values(this.state.devices).filter(d => !d.revoked) }
  register(descriptor: AccountDeviceDescriptor): ReturnType<Store['issue']> {
    const old = this.state.devices[descriptor.deviceId]
    if (old?.revoked) throw new ApiError('DEVICE_REVOKED', 403)
    if (old && (old.descriptor.identityKey !== descriptor.identityKey || old.descriptor.role !== descriptor.role)) throw new ApiError('PEER_IDENTITY_MISMATCH', 409)
    if (!old && Object.keys(this.state.devices).length >= 256) throw new ApiError('RATE_LIMITED', 429)
    this.state.devices[descriptor.deviceId] = { descriptor, revoked: false, lastSeenAt: old?.lastSeenAt ?? 0 }
    this.invalidate(descriptor.deviceId)
    return this.issue(descriptor.deviceId)
  }
  private issue(deviceId: string, refreshTokenExpiresAt = Date.now() + 30 * 86400_000) {
    for (const [key, value] of Object.entries(this.state.tokens)) if (value.expires <= Date.now()) delete this.state.tokens[key]
    if (Object.keys(this.state.tokens).length >= 16384) throw new ApiError('RATE_LIMITED', 429)
    const accessToken = secret(), refreshToken = secret()
    const accessTokenExpiresAt = Date.now() + 60 * 60_000
    this.state.tokens[hash(accessToken)] = { kind: 'access', deviceId, expires: accessTokenExpiresAt, used: false }
    this.state.tokens[hash(refreshToken)] = { kind: 'refresh', deviceId, expires: refreshTokenExpiresAt, used: false }
    this.save()
    return { accessToken, refreshToken, accessTokenExpiresAt, refreshTokenExpiresAt }
  }
  authenticate(token: string): SavedDevice {
    const record = this.state.tokens[hash(token)]
    if (!record || record.kind !== 'access') throw new ApiError('AUTH_INVALID', 401)
    if (record.expires <= Date.now()) throw new ApiError('TOKEN_EXPIRED', 401)
    return this.get(record.deviceId)
  }
  refresh(deviceId: string, token: string) {
    this.get(deviceId)
    const record = this.state.tokens[hash(token)]
    if (!record || record.kind !== 'refresh' || record.deviceId !== deviceId) throw new ApiError('AUTH_INVALID', 401)
    if (record.expires <= Date.now()) throw new ApiError('TOKEN_EXPIRED', 401)
    if (record.used) { this.invalidate(deviceId); throw new ApiError('AUTH_INVALID', 401) }
    record.used = true
    return this.issue(deviceId, record.expires)
  }
  invalidate(deviceId: string): void {
    for (const [key, value] of Object.entries(this.state.tokens)) if (value.deviceId === deviceId) delete this.state.tokens[key]
    this.onInvalidate(deviceId)
    this.save()
  }
  revoke(id: string): void { this.get(id).revoked = true; this.invalidate(id) }
  touch(id: string, clientVersion?: string, harnessVersion?: string): void {
    const d = this.get(id)
    d.lastSeenAt = Date.now()
    if (clientVersion) d.descriptor.clientVersion = clientVersion.slice(0, 64)
    if (d.descriptor.role === 'host' && harnessVersion) d.descriptor.harnessVersion = harnessVersion.slice(0, 64)
    this.save()
  }
}
