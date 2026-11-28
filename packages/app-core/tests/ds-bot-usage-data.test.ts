import { describe, expect, it } from 'vitest'
import { buildDsBotActivityYear, buildDsBotUsageView } from '../src/screens/bot/ds-bot-usage-data'

describe('ds-bot usage data', () => {
  it('defaults activity heatmap to 53 Monday-aligned weeks and computes day levels', () => {
    const raw = {
      now: '2026-06-15 12',
      rows: [
        ['2026-06-15 10', 0, 0, 0, 800, 200, 0, 100, 2],
        ['2026-06-14 09', 0, 0, 0, 200, 0, 0, 50, 1],
      ],
    }
    const year = buildDsBotActivityYear(raw)
    expect(year.weeks).toHaveLength(53)
    for (const week of year.weeks) {
      expect(week).toHaveLength(7)
      expect(new Date(`${week[0]!.date}T00:00:00Z`).getUTCDay()).toBe(1)
    }
    expect(year.activeDays).toBe(2)
    expect(year.maxTokens).toBe(1100)
    const todayCell = year.weeks.flat().find(cell => cell.date === '2026-06-15')
    expect(todayCell?.level).toBe(4)
  })

  it('computes 30d buckets without truncation, deltaPct, scanning, and stacked bucket keys', () => {
    const raw = {
      now: '2026-06-15 12',
      scanning: true,
      owners: [
        { key: 'chief', id: 'chief', name: 'Chief', kind: 'bot' },
        { key: 'coder', id: 'coder', name: 'Coder', kind: 'bot' },
      ],
      models: [
        { key: 'ds-chat', name: 'deepseek-chat', providerName: 'DeepSeek' },
      ],
      rows: [
        ['2026-06-15 10', 0, 0, 0, 1000, 500, 0, 500, 2],
        ['2026-06-15 11', 1, 0, 0, 500, 0, 0, 500, 1],
        ['2026-05-05 10', 0, 0, 0, 800, 0, 0, 200, 1],
      ],
    }
    const view30 = buildDsBotUsageView(raw, '30d')
    expect(view30.scanning).toBe(true)
    expect(view30.buckets).toHaveLength(30)
    expect(view30.deltaPct).toBe(200)
    expect(view30.byOwner[0]?.bucketKey).toBe('0')
    expect(view30.byOwner[1]?.bucketKey).toBe('1')
    const latestBucket = view30.buckets.at(-1)!
    expect(latestBucket.byOwner['0']).toBe(2000)
    expect(latestBucket.byOwner['1']).toBe(1000)
    expect(latestBucket.byModel['0']).toBe(3000)

    const view24 = buildDsBotUsageView(raw, '24h')
    expect(view24.buckets).toHaveLength(24)
  })
})
