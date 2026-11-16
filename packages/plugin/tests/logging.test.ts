import { describe, expect, it, vi } from 'vitest'
import { SafeLogger, type LogLevel } from '../src/logging.js'

describe('live debug logging', () => {
  it('applies threshold changes to the existing logger and retains redaction', () => {
    let level: LogLevel = 'info'
    const sink = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const logger = new SafeLogger(sink, () => level)
    logger.debug('hidden')
    expect(sink.debug).not.toHaveBeenCalled()
    level = 'debug'
    logger.debug('connection', { token: 'private-token', nested: { prompt: 'private-prompt' }, state: 'ready' })
    expect(sink.debug).toHaveBeenCalledOnce()
    expect(sink.debug.mock.calls[0]?.[0]).toContain('ready')
    expect(sink.debug.mock.calls[0]?.[0]).not.toContain('private-')
    level = 'info'
    logger.debug('hidden again')
    expect(sink.debug).toHaveBeenCalledOnce()
  })

  it('redacts password, passphrase, credential and apiKey fields', () => {
    const sink = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const logger = new SafeLogger(sink, 'info')
    logger.info('auth', { password: 'p1', passphrase: 'p2', credential: 'c1', apiKey: 'k1', ok: 'yes' })
    const line = sink.info.mock.calls[0]?.[0] ?? ''
    expect(line).toContain('yes')
    expect(line).not.toContain('p1')
    expect(line).not.toContain('p2')
    expect(line).not.toContain('c1')
    expect(line).not.toContain('k1')
  })
})
