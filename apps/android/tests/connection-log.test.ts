import { describe, expect, it, vi } from 'vitest'
import { connectionLog, connectionLogText } from '../src/services/connection-log'

describe('connection diagnostics', () => {
  it('bounds the buffer and excludes credentials, arbitrary text and payloads', () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
    for (let attempt = 0; attempt < 501; attempt++) connectionLog('connect', { attempt })
    connectionLog('disconnect', {
      token: 'secret-token', payload: 'private prompt', reason: 'https://user:password@server/?token=secret',
      closeCode: 4001, transport: 'p2p',
    })
    const text = connectionLogText('0.6.3')
    expect(text.split('\n').filter(line => /Z (connect|disconnect) /.test(line))).toHaveLength(500)
    expect(text).not.toContain('"attempt":0}')
    expect(text).toContain('"closeCode":4001')
    expect(text).toContain('"transport":"p2p"')
    for (const secret of ['secret-token', 'private prompt', 'password', 'https://']) expect(text).not.toContain(secret)
    vi.restoreAllMocks()
  })
})
