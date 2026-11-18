import { build } from 'esbuild'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = join(process.cwd(), 'apps/harmony/entry/src/main/ets/services/PushToken.ets')
const stub = `
export const state = { permission: true, token: 'initial', callback: undefined, getToken: undefined, deleteToken: undefined };
export const notificationManager = { isNotificationEnabled: async () => state.permission };
export const pushService = {
  on: (_type, _ability, callback) => { state.callback = callback; },
  off: (_type, callback) => { if (state.callback === callback) state.callback = undefined; },
  getToken: async () => state.getToken ? state.getToken() : state.token,
  deleteToken: async () => state.deleteToken ? state.deleteToken() : undefined
};
`
async function setup() {
  const result = await build({ entryPoints: [source], bundle: true, write: false, format: 'esm',
    loader: { '.ets': 'ts' }, plugins: [{ name: 'kit-stubs', setup(build) {
      build.onResolve({ filter: /^@kit\./ }, () => ({ path: 'kit', namespace: 'mock' }))
      build.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({ contents: stub, loader: 'ts' }))
    } }],
    footer: { js: "export { state };" },
  })
  // Both SDK imports resolve to one module; inject its exported test state through the bundle.
  const code = result.outputFiles[0].text
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}#${Math.random()}`)
}

describe('PushKit token lifecycle', () => {
  it('requires explicit opt-in and notification permission', async () => {
    const { PushToken, state } = await setup()
    const service = new PushToken({})
    expect(await service.current()).toBe('')
    expect(state.callback).toBeUndefined()
    state.permission = false
    expect(await service.enable()).toBe(false)
    expect(state.callback).toBeUndefined()
    state.permission = true
    expect(await service.enable()).toBe(true)
    expect(await service.current()).toBe('initial')
    state.permission = false
    expect(await service.current()).toBe('')
    expect(state.callback).toBeUndefined()
  })
  it('accepts updates and rejects an older in-flight fetch', async () => {
    const { PushToken, state } = await setup()
    const service = new PushToken({})
    await service.enable()
    let finish!: (token: string) => void
    state.getToken = () => new Promise<string>(resolve => { finish = resolve })
    const refresh = service.refresh()
    await new Promise(resolve => setTimeout(resolve, 0))
    state.callback('new')
    await new Promise(resolve => setTimeout(resolve, 0))
    finish('old')
    expect(await refresh).toBe(false)
    expect(await service.current()).toBe('new')
  })
  it('disabling invalidates in-flight token retrieval', async () => {
    const { PushToken, state } = await setup()
    const service = new PushToken({})
    await service.enable()
    let finish!: (token: string) => void
    state.getToken = () => new Promise<string>(resolve => { finish = resolve })
    const refresh = service.refresh()
    await new Promise(resolve => setTimeout(resolve, 0))
    service.disable()
    finish('secret')
    expect(await refresh).toBe(false)
    expect(await service.current()).toBe('')
    expect(state.callback).toBeUndefined()
  })
  it('signals only actual token changes and revocation without exposing a token', async () => {
    const { PushToken, state } = await setup()
    const events: string[] = []
    const service = new PushToken({}, (event: string) => events.push(event))
    await service.enable()
    expect(events).toEqual(['changed'])
    await service.refresh()
    state.callback('initial')
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(events).toEqual(['changed'])
    state.callback('rotated-secret')
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(events).toEqual(['changed', 'changed'])
    state.permission = false
    state.callback('never-deliver')
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(events).toEqual(['changed', 'changed', 'disabled'])
    service.disable()
    expect(events).toEqual(['changed', 'changed', 'disabled'])
    expect(await service.current()).toBe('')
  })
  it('does not signal a token arriving after disable', async () => {
    const { PushToken, state } = await setup()
    const events: string[] = []
    const service = new PushToken({}, (event: string) => events.push(event))
    await service.enable()
    let finish!: (token: string) => void
    state.getToken = () => new Promise<string>(resolve => { finish = resolve })
    const refresh = service.refresh()
    await new Promise(resolve => setTimeout(resolve, 0))
    service.disable()
    finish('late-secret')
    await refresh
    expect(events).toEqual(['changed', 'disabled'])
  })
  it('retries failed deletion and blocks enable while deletion is pending', async () => {
    const { PushToken, state } = await setup()
    const service = new PushToken({})
    await service.enable()
    state.deleteToken = () => Promise.reject(new Error('offline'))
    expect(await service.revoke()).toBe(false)
    expect(await service.current()).toBe('')
    expect(await service.enable()).toBe(false)
    let finish!: () => void
    state.deleteToken = () => new Promise<void>(resolve => { finish = resolve })
    const pending = service.revoke()
    expect(await service.enable()).toBe(false)
    finish()
    expect(await pending).toBe(true)
    expect(await service.enable()).toBe(true)
  })

})
