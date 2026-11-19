import { describe, expect, it } from 'vitest'
import { authorizeUpstream } from '../src/dsh-web-host.js'
import type { OpenMessage } from '../src/hostc/protocol/index.js'

describe('DSH Web Host forwarding boundary', () => {
  const url = new URL('https://test.hostc.4ba.io/')
  const request: OpenMessage = { method: 'GET', path: '/api/web', headers: [], body: false }

  it.each(['/ds-harness-remote/api', '/%64s-harness-remote/api', '/%252e%252e/',
    '/api/../connect', '/connect', '/%2Fother.test/', '/?%74oken=bad'])('rejects sensitive target %s', path => {
    expect(authorizeUpstream({ ...request, path }, url, 'local=owned')).toBeUndefined()
  })

  it('replaces caller credentials and preserves an exact public Origin for normalization', () => {
    expect(authorizeUpstream({ ...request, headers: [
      ['cookie', 'fake=grant'], ['authorization', 'Bearer visitor'], ['x-forwarded-host', 'other.test'],
      ['origin', url.origin],
    ] }, url, 'local=owned')?.headers).toEqual([['origin', url.origin], ['cookie', 'local=owned']])
    expect(authorizeUpstream({ ...request, headers: [['origin', url.origin + '.other.test']] }, url, 'local=owned')).toBeUndefined()
  })
})
