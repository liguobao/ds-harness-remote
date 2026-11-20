import { build } from 'esbuild'
import { dshWebGrantSchema } from '../../../packages/protocol/src/dsh-web'
import { beforeAll, describe, expect, it } from 'vitest'

type Grant = { url: string; origin: string; browserGrant: string }
let harmony: {
  parseDshWebGrant(value: unknown, now: number): Grant
  isDshWebOrigin(target: string, origin: string): boolean
  isFatalDshWebHttpError(target: string, status: number, grantUrl: string, origin: string): boolean
}

beforeAll(async () => {
  const source = new URL('../entry/src/main/ets/net/DshWebGrant.ets', import.meta.url)
  const result = await build({
    entryPoints: [decodeURIComponent(source.pathname)],
    bundle: true,
    write: false,
    format: 'esm',
    loader: { '.ets': 'ts' },
    resolveExtensions: ['.ets', '.ts', '.js'],
    plugins: [{
      name: 'arkts-url-shim',
      setup(builder) {
        builder.onResolve({ filter: /^@kit\.ArkTS$/ }, () => ({ path: 'url', namespace: 'arkts' }))
        builder.onLoad({ filter: /^url$/, namespace: 'arkts' }, () => ({
          contents: 'export const url = { URL: { parseURL: value => new URL(value) } }',
        }))
      },
    }],
  })
  harmony = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`)
})

const now = 1_800_000_000_000
const grantUrl = 'https://dsh.example/'
const grant = { url: grantUrl, browserGrant: 'a'.repeat(43), expiresAt: now + 60_000 }

describe('Harmony DSH Web protocol parity', () => {
  it.each([
    grant,
    { ...grant, url: 'https://DSH.example:443' },
    { ...grant, url: 'https://[2001:db8::1]:8443/' },
    { ...grant, url: 'https://dsh.example/path' },
    { ...grant, url: 'https://user@dsh.example/' },
    { ...grant, url: 'http://dsh.example/' },
    { ...grant, url: 'https://dsh.example/?query' },
    { ...grant, browserGrant: 'invalid' },
    { ...grant, expiresAt: 0 },
    { ...grant, extra: true },
  ])('agrees with the shared grant schema for %o', (value) => {
    const reference = dshWebGrantSchema.safeParse(value)
    if (reference.success) {
      const canonical = new URL(reference.data.url)
      expect(harmony.parseDshWebGrant(value, now)).toMatchObject({
        url: canonical.href, origin: canonical.origin, browserGrant: reference.data.browserGrant,
      })
    } else {
      expect(() => harmony.parseDshWebGrant(value, now)).toThrow()
    }
  })

  it('matches the Android expiry boundary', () => {
    expect(() => harmony.parseDshWebGrant({ ...grant, expiresAt: now - 59_999 }, now)).not.toThrow()
    expect(() => harmony.parseDshWebGrant({ ...grant, expiresAt: now - 60_000 }, now)).toThrow()
  })

  it('checks origin and distinguishes bootstrap errors from resource errors', () => {
    const origin = 'https://dsh.example'
    expect(harmony.isDshWebOrigin('https://DSH.example:443/next', origin)).toBe(true)
    expect(harmony.isDshWebOrigin('https://dsh.example.evil.example/', origin)).toBe(false)
    expect(harmony.isDshWebOrigin('http://dsh.example/', origin)).toBe(false)
    expect(harmony.isFatalDshWebHttpError(grantUrl, 404, grantUrl, origin)).toBe(true)
    expect(harmony.isFatalDshWebHttpError(grantUrl + '__remote/session', 403, grantUrl, origin)).toBe(true)
    expect(harmony.isFatalDshWebHttpError(grantUrl + 'asset.js', 404, grantUrl, origin)).toBe(false)
    expect(harmony.isFatalDshWebHttpError(grantUrl + 'api/session', 503, grantUrl, origin)).toBe(true)
    expect(harmony.isFatalDshWebHttpError('https://other.example/', 503, grantUrl, origin)).toBe(false)
  })
})
