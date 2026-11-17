// Validates the Android notification string resources that
// plugins/with-remote-foreground-service.js writes into the native project.
//
// This lives with the Android app rather than in packages/app-core because it
// asserts on that config plugin's source. The shared live-task logic
// (backendBadge, pickActiveLiveTask, the foregroundService fallbacks) is tested
// in packages/app-core/tests/live-task-notification.test.ts.
import { describe, expect, it } from 'vitest'

describe('live task notification locale resources', () => {
  const getLocales = async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const vm = await import('node:vm')
    const filePath = path.resolve(__dirname, '../plugins/with-remote-foreground-service.js')
    const code = fs.readFileSync(filePath, 'utf8')
    const match = code.match(/const stringLocales = (\{[\s\S]*?\n\})/)
    if (!match) throw new Error('stringLocales not found in with-remote-foreground-service.js')
    const sandbox = { result: {} as Record<string, Record<string, string>> }
    vm.runInNewContext('result = ' + match[1], sandbox)
    return sandbox.result
  }

  it('defines string resources for all supported locales', async () => {
    const stringLocales = await getLocales()

    const requiredKeys = [
      'ask_agent_process_text',
      'live_task_time_just_now',
      'live_task_time_minutes_ago',
      'live_task_time_hours_ago',
      'live_task_time_days_ago',
      'live_task_status_running',
      'live_task_status_waiting',
    ]

    const expectedLocales = [
      'values',
      'values-zh',
      'values-zh-rCN',
      'values-zh-rTW',
      'values-zh-rHK',
      'values-ja',
      'values-es',
      'values-fr',
      'values-de',
    ]

    for (const locale of expectedLocales) {
      const localeMap = stringLocales[locale]
      expect(localeMap, `missing locale ${locale}`).toBeDefined()
      if (!localeMap) continue
      for (const key of requiredKeys) {
        const val = localeMap[key]
        expect(val, `missing ${key} in ${locale}`).toBeDefined()
        expect(typeof val).toBe('string')
        expect(val?.trim().length).toBeGreaterThan(0)
      }
    }
  })

  it('contains valid integer formatting specifiers for relative time strings', async () => {
    const stringLocales = await getLocales()
    for (const locale of Object.keys(stringLocales)) {
      const stringsMap = stringLocales[locale]
      expect(stringsMap).toBeDefined()
      if (!stringsMap) continue
      expect(stringsMap.live_task_time_minutes_ago).toMatch(/%(?:1\$)?[d]/)
      expect(stringsMap.live_task_time_hours_ago).toMatch(/%(?:1\$)?[d]/)
      expect(stringsMap.live_task_time_days_ago).toMatch(/%(?:1\$)?[d]/)
    }
  })

  it('does not leak Chinese text into non-Chinese locales', async () => {
    const stringLocales = await getLocales()
    const chinesePattern = /[\u4e00-\u9fa5]/
    const nonChineseLocales = ['values', 'values-es', 'values-fr', 'values-de']
    for (const locale of nonChineseLocales) {
      const map = stringLocales[locale]
      expect(map).toBeDefined()
      if (!map) continue
      for (const [key, value] of Object.entries(map)) {
        expect(chinesePattern.test(value), `${locale}.${key} contains Chinese: ${value}`).toBe(false)
      }
    }
  })
})
