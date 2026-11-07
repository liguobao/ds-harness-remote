import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { generateKeyPair } from '../../../packages/crypto/src/index.js'
import { Store, hash, secret } from '../src/store.js'
import { runScenarios } from '../../../scripts/test-scenarios.mjs'

const account = 'owner@example.com', password = 'test-only-password'
let dir: string, file: string, store: Store, now: number
const descriptor = () => ({
  deviceId: randomUUID(), name: 'test', identityKey: generateKeyPair().publicKey,
  role: 'client' as const, platform: 'linux', clientVersion: '0.6.3',
})
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'refresh-recovery-')); file = join(dir, 'state.json')
  now = Date.now()
  vi.spyOn(Date, 'now').mockImplementation(() => now)
  store = new Store(file, account, password)
})
afterEach(() => { vi.restoreAllMocks(); rmSync(dir, { recursive: true, force: true }) })
const saved = () => JSON.parse(readFileSync(file, 'utf8'))
function rewrite(change: (state: ReturnType<typeof saved>) => void) {
  const state = saved(); change(state); writeFileSync(file, JSON.stringify(state))
  store = new Store(file, account, password)
}

it('recovers after the access bearer expires and is pruned without extending refresh lifetime', () => {
  const d = descriptor(), original = store.register(d), rotated = store.refresh(d.deviceId, original.refreshToken)
  now += 2 * 60 * 60_000
  store.register(descriptor()) // normal expiry cleanup removes the old access bearer
  store = new Store(file, account, password)
  expect(store.refresh(d.deviceId, original.refreshToken)).toEqual(rotated)
  expect(() => store.authenticate(rotated.accessToken)).toThrow()
  const next = store.refresh(d.deviceId, rotated.refreshToken)
  expect(next.refreshTokenExpiresAt).toBe(original.refreshTokenExpiresAt)
  expect(store.authenticate(next.accessToken).descriptor.deviceId).toBe(d.deviceId)
  now = original.refreshTokenExpiresAt
  expect(() => store.refresh(d.deviceId, original.refreshToken)).toThrow('TOKEN_EXPIRED')
  expect(() => store.refresh(d.deviceId, next.refreshToken)).toThrow('TOKEN_EXPIRED')
})

it('keeps revoke, registration, account and device boundaries on recoverable tokens', async () => {
  await runScenarios(['revoke', 'register', 'password', 'account', 'other-device', 'invalid-token'].map(kind => ({
    name: kind, run: () => {
      const path = join(dir, kind + '.json'), d = descriptor(), other = descriptor()
      let s = new Store(path, account, password)
      const old = s.register(d), pair = s.refresh(d.deviceId, old.refreshToken)
      const unrelated = s.register(other)
      if (kind === 'revoke') s.revoke(d.deviceId)
      if (kind === 'register') {
        const replacement = s.register(d)
        expect(s.authenticate(replacement.accessToken).descriptor.deviceId).toBe(d.deviceId)
      }
      if (kind === 'password') s = new Store(path, account, 'changed-password')
      if (kind === 'account') s = new Store(path, 'different@example.com', password)
      const target = kind === 'other-device' ? other.deviceId : d.deviceId
      const token = kind === 'invalid-token' ? secret() : old.refreshToken
      expect(() => s.refresh(target, token)).toThrow()
      if (kind === 'other-device' || kind === 'invalid-token') {
        expect(s.refresh(d.deviceId, old.refreshToken)).toEqual(pair)
        expect(s.authenticate(unrelated.accessToken).descriptor.deviceId).toBe(other.deviceId)
      } else expect(() => s.authenticate(pair.accessToken)).toThrow()
    },
  })))
})

it('rotates legacy unused tokens but rejects legacy consumed tokens without revoking the successor', () => {
  const d = descriptor(), old = store.register(d)
  // Old state has no optional recovery field; it remains readable.
  store = new Store(file, account, password)
  const pair = store.refresh(d.deviceId, old.refreshToken)
  rewrite(state => { delete state.tokens[hash(old.refreshToken)].recovery })
  expect(() => store.refresh(d.deviceId, old.refreshToken)).toThrow('AUTH_INVALID')
  expect(store.authenticate(pair.accessToken).descriptor.deviceId).toBe(d.deviceId)
  expect(store.refresh(d.deviceId, pair.refreshToken).refreshToken).not.toBe(pair.refreshToken)
})

it('does not consume a refresh token on failed persistence or exhausted storage', () => {
  const d = descriptor(), old = store.register(d), before = readFileSync(file, 'utf8')
  mkdirSync(file + '.tmp') // force writeFileSync to fail, even when running as root
  expect(() => store.refresh(d.deviceId, old.refreshToken)).toThrow()
  expect(readFileSync(file, 'utf8')).toBe(before)
  rmSync(file + '.tmp', { recursive: true })
  const pair = store.refresh(d.deviceId, old.refreshToken)
  expect(store.refresh(d.deviceId, old.refreshToken)).toEqual(pair)
  rewrite(state => {
    const count = Object.keys(state.tokens).length
    for (let i = count; i < 16383; i++) state.tokens[hash('filler-' + i)] = {
      kind: 'access', deviceId: d.deviceId, expires: now + 60_000, used: false,
    }
  })
  expect(() => store.refresh(d.deviceId, pair.refreshToken)).toThrow('RATE_LIMITED')
  expect(saved().tokens[hash(pair.refreshToken)].used).toBe(false)
  now += 60_001 // fillers expire, retry uses the unconsumed token
  expect(store.refresh(d.deviceId, pair.refreshToken).refreshToken).not.toBe(pair.refreshToken)
})

it('fails closed on damaged recovery metadata without revoking valid credentials', async () => {
  await runScenarios(['nonce', 'missing-successor', 'wrong-device', 'missing-access'].map(kind => ({
    name: kind, run: () => {
      const d = descriptor(), old = store.register(d), pair = store.refresh(d.deviceId, old.refreshToken)
      rewrite(state => {
        if (kind === 'nonce') state.tokens[hash(old.refreshToken)].recovery.nonce = secret()
        if (kind === 'missing-successor') delete state.tokens[hash(pair.refreshToken)]
        if (kind === 'wrong-device') state.tokens[hash(pair.refreshToken)].deviceId = randomUUID()
        if (kind === 'missing-access') delete state.tokens[hash(pair.accessToken)]
      })
      try { store.refresh(d.deviceId, old.refreshToken); expect.unreachable() }
      catch (error) { expect(error).toMatchObject({ code: 'INTERNAL_ERROR', status: 503 }) }
      if (kind !== 'missing-access') expect(store.authenticate(pair.accessToken).descriptor.deviceId).toBe(d.deviceId)
      expect(saved().tokens[hash(old.refreshToken)]).toBeDefined()
    },
  })))
})
