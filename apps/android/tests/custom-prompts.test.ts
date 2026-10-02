import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as SecureStore from 'expo-secure-store'

const store = new Map<string, string>()

vi.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'whenUnlockedThisDeviceOnly',
  getItemAsync: vi.fn(async (key: string) => store.get(key) ?? null),
  setItemAsync: vi.fn(async (key: string, value: string) => { store.set(key, value) }),
  deleteItemAsync: vi.fn(async (key: string) => { store.delete(key) }),
  isAvailableAsync: vi.fn(async () => true),
}))
vi.mock('expo-application', () => ({ applicationId: 'io.github.liguobao.dshremote' }))
vi.mock('expo-device', () => ({ modelName: 'Pixel' }))
vi.mock('expo-crypto', () => ({ getRandomBytes: () => new Uint8Array(32), randomUUID: () => 'uuid' }))

import { applyLanguagePreference } from '../src/locales/i18n'
import enUS from '../src/locales/en-US'
import zhCN from '../src/locales/zh-CN'
import {
  BUILT_IN_PROMPTS,
  getBuiltInPrompts,
  loadCustomPrompts,
  saveCustomPrompts,
  type CustomPrompt,
} from '../src/services/storage'

const KEY = 'dshremote.custom-prompts.v1'
const titles = (items: readonly CustomPrompt[]) => items.map(item => `${item.title}|${item.text}`)

/** Mirrors the write path in chat-screen: full list plus the deleted built-in ids. */
async function persist(next: CustomPrompt[]) {
  const removed = BUILT_IN_PROMPTS.filter(item => !next.some(prompt => prompt.id === item.id)).map(item => item.id)
  await saveCustomPrompts(next, removed)
}

const custom = (id: string, title: string, text: string): CustomPrompt => ({ id, title, text })

const builtIn = (id: string): CustomPrompt => {
  const found = BUILT_IN_PROMPTS.find(item => item.id === id)
  if (found === undefined) throw new Error(`unknown built-in prompt: ${id}`)
  return { ...found }
}

beforeEach(() => {
  store.clear()
  applyLanguagePreference('zh-CN')
  vi.mocked(SecureStore.setItemAsync).mockImplementation(async (key: string, value: string) => {
    store.set(key, value)
  })
})

afterEach(() => {
  applyLanguagePreference('zh-CN')
})

describe('custom prompt persistence', () => {
  it('seeds the three built-in prompts on a fresh install', async () => {
    await expect(loadCustomPrompts()).resolves.toEqual([...BUILT_IN_PROMPTS])
  })

  it('keeps an edited built-in prompt across a reload', async () => {
    const edited = BUILT_IN_PROMPTS.map(item => item.id === 'builtin-commit' ? { ...item, title: '提交改动', text: '直接提交。' } : item)
    await persist(edited)

    const loaded = await loadCustomPrompts()
    expect(titles(loaded)).toEqual(titles(edited))
    expect(loaded.find(item => item.id === 'builtin-commit')).toEqual({ id: 'builtin-commit', title: '提交改动', text: '直接提交。' })
  })

  it('keeps a deleted built-in prompt deleted across a reload', async () => {
    const kept = BUILT_IN_PROMPTS.filter(item => item.id !== 'builtin-view-screenshot')
    await persist(kept)

    const loaded = await loadCustomPrompts()
    expect(loaded.map(item => item.id)).toEqual(kept.map(item => item.id))
  })

  it('round-trips an added custom prompt and its deletion', async () => {
    const added = [...BUILT_IN_PROMPTS, custom('prompt-1', '我的提示词', '跑一遍测试。')]
    await persist(added)
    expect((await loadCustomPrompts()).map(item => item.id)).toEqual([...BUILT_IN_PROMPTS.map(item => item.id), 'prompt-1'])

    await persist([...BUILT_IN_PROMPTS])
    expect(await loadCustomPrompts()).toEqual([...BUILT_IN_PROMPTS])
  })

  it('combines an edited, a deleted and an added prompt in one write', async () => {
    const next = [
      { ...builtIn('builtin-check-changes'), title: '检查改动（改）' },
      builtIn('builtin-commit'),
      custom('prompt-2', '新提示词', '正文。'),
    ]
    await persist(next)

    const loaded = await loadCustomPrompts()
    expect(loaded.map(item => item.id)).toEqual(['builtin-check-changes', 'builtin-commit', 'prompt-2'])
    expect(loaded.find(item => item.id === 'builtin-check-changes')?.title).toBe('检查改动（改）')
  })

  it('migrates legacy data that kept only custom items and had no removed list', async () => {
    store.set(KEY, JSON.stringify({ items: [custom('prompt-legacy', '旧提示词', '旧正文。')] }))
    await expect(loadCustomPrompts()).resolves.toEqual([...BUILT_IN_PROMPTS, custom('prompt-legacy', '旧提示词', '旧正文。')])
  })

  it('ignores malformed stored entries instead of throwing', async () => {
    store.set(KEY, JSON.stringify({
      items: [custom('prompt-ok', '好的', '正文。'), { id: '', title: 'x', text: 'y' }, { id: 'prompt-bad', title: '', text: 'y' }],
      removed: ['builtin-commit', 42, null],
    }))

    const loaded = await loadCustomPrompts()
    expect(loaded.map(item => item.id)).toEqual(['builtin-check-changes', 'builtin-view-screenshot', 'prompt-ok'])
  })

  it('drops everything when every prompt is deleted', async () => {
    await persist([])
    await expect(loadCustomPrompts()).resolves.toEqual([])
  })
})

describe('localized built-in prompts', () => {
  it('materializes English built-in prompts with explicit enUS messages', () => {
    const enPrompts = getBuiltInPrompts(enUS)
    expect(enPrompts).toEqual([
      {
        id: 'builtin-check-changes',
        title: enUS.chat.quickCheckChanges,
        text: enUS.chat.quickCheckChangesPrompt,
      },
      {
        id: 'builtin-commit',
        title: enUS.chat.quickCommit,
        text: enUS.chat.quickCommitPrompt,
      },
      {
        id: 'builtin-view-screenshot',
        title: enUS.chat.quickViewScreenshot,
        text: enUS.chat.quickViewScreenshotPrompt,
      },
    ])
  })

  it('materializes English built-in prompts from active language preference', async () => {
    applyLanguagePreference('en-US')
    const active = getBuiltInPrompts()
    expect(active.map(p => p.title)).toEqual([
      'Review changes',
      'Commit changes',
      'Review screenshot',
    ])
    expect(await loadCustomPrompts()).toEqual(getBuiltInPrompts(enUS))
  })

  it('switching locale updates unedited built-ins while preserving custom items and user overrides', async () => {
    applyLanguagePreference('zh-CN')

    const userPrompts: CustomPrompt[] = [
      { id: 'builtin-check-changes', title: '检查改动', text: '检查当前代码改动并指出问题。' },
      { id: 'builtin-commit', title: '我的提交', text: '直接执行提交。' },
      custom('prompt-user-1', '代码审查', '仔细阅读并指出代码缺陷。'),
    ]
    await saveCustomPrompts(userPrompts, ['builtin-view-screenshot'])

    applyLanguagePreference('en-US')
    const loadedEn = await loadCustomPrompts()

    expect(loadedEn.find(p => p.id === 'builtin-check-changes')).toEqual({
      id: 'builtin-check-changes',
      title: 'Review changes',
      text: 'Review the current code changes and point out any issues.',
    })

    expect(loadedEn.find(p => p.id === 'builtin-commit')).toEqual({
      id: 'builtin-commit',
      title: '我的提交',
      text: '直接执行提交。',
    })

    expect(loadedEn.find(p => p.id === 'builtin-view-screenshot')).toBeUndefined()

    expect(loadedEn.find(p => p.id === 'prompt-user-1')).toEqual({
      id: 'prompt-user-1',
      title: '代码审查',
      text: '仔细阅读并指出代码缺陷。',
    })

    applyLanguagePreference('zh-CN')
    const loadedZh = await loadCustomPrompts()

    expect(loadedZh.find(p => p.id === 'builtin-check-changes')).toEqual({
      id: 'builtin-check-changes',
      title: '检查改动',
      text: '检查当前代码改动并指出问题。',
    })
    expect(loadedZh.find(p => p.id === 'builtin-commit')).toEqual({
      id: 'builtin-commit',
      title: '我的提交',
      text: '直接执行提交。',
    })
    expect(loadedZh.find(p => p.id === 'prompt-user-1')).toEqual({
      id: 'prompt-user-1',
      title: '代码审查',
      text: '仔细阅读并指出代码缺陷。',
    })
  })
})

describe('serialization and write failure handling', () => {
  it('serializes rapid consecutive writes strictly in order', async () => {
    const callOrder: string[] = []
    const setItemMock = vi.mocked(SecureStore.setItemAsync)

    setItemMock.mockImplementation(async (key: string, value: string) => {
      const parsed = JSON.parse(value) as { items: CustomPrompt[] }
      const marker = parsed.items[0]?.title ?? 'empty'
      callOrder.push(`start:${marker}`)
      await new Promise(resolve => setTimeout(resolve, 10))
      store.set(key, value)
      callOrder.push(`finish:${marker}`)
    })

    const write1 = saveCustomPrompts([custom('p1', 'first', '1')])
    const write2 = saveCustomPrompts([custom('p2', 'second', '2')])
    const write3 = saveCustomPrompts([custom('p3', 'third', '3')])

    await Promise.all([write1, write2, write3])

    expect(callOrder).toEqual([
      'start:first',
      'finish:first',
      'start:second',
      'finish:second',
      'start:third',
      'finish:third',
    ])

    const finalLoaded = await loadCustomPrompts()
    expect(finalLoaded.find(p => p.id === 'p3')?.title).toBe('third')
  })

  it('rejects the returned promise on write failure so callers can detect error', async () => {
    const setItemMock = vi.mocked(SecureStore.setItemAsync)
    setItemMock.mockRejectedValueOnce(new Error('Disk write failed'))

    await expect(saveCustomPrompts([custom('p-err', 'error', 'err')])).rejects.toThrow('Disk write failed')
  })

  it('allows subsequent writes to succeed even after a previous write failed in the queue', async () => {
    const setItemMock = vi.mocked(SecureStore.setItemAsync)
    setItemMock.mockRejectedValueOnce(new Error('Storage unavailable'))

    const writeFail = saveCustomPrompts([custom('p-fail', 'fail', 'fail')])
    const writeOk = saveCustomPrompts([custom('p-ok', 'ok', 'ok')])

    await expect(writeFail).rejects.toThrow('Storage unavailable')
    await expect(writeOk).resolves.toBeUndefined()

    const loaded = await loadCustomPrompts()
    expect(loaded.find(p => p.id === 'p-ok')).toBeDefined()
  })
})
