import { describe, expect, it } from 'vitest'
import { runScenarios } from '../../../scripts/test-scenarios.mjs'
import { checkedBotView } from '../src/services/bot-view'
import { resolve, validateViewAnswer, viewScope } from '../src/vendor/ds-bot/views.js'

const calculator = () => ({ type: 'stack', let: { total: 'qty * 12' }, children: [
  { type: 'slider', id: 'qty', label: 'Quantity', min: 1, max: 10, value: 2 },
  { type: 'metric', label: 'Total', value: { '=': 'total' } },
  { type: 'submit', id: 'send', label: 'Send' },
] })

describe('Android Bot view trust boundary', () => {
  it('rejects unsafe or over-budget blueprints before rendering or evaluating', async () => {
    let deep: unknown = { type: 'text', text: 'nested' }
    for (let i = 0; i < 40; i++) deep = { item: deep }
    await runScenarios([
      { name: 'unknown component', view: { type: 'script', text: 'run()' } },
      { name: 'property access', view: { type: 'metric', label: '', value: { '=': 'globalThis.fetch' } } },
      { name: 'function injection', view: { type: 'metric', label: '', value: { '=': 'eval("1")' } } },
      { name: 'assignment', view: { type: 'metric', label: '', value: { '=': 'qty = 2' } } },
      { name: 'cycle', view: { type: 'stack', let: { x: 'x + 1' }, children: [{ type: 'metric', label: '', value: { '=': 'x' } }] } },
      { name: 'prototype key', view: JSON.parse('{"type":"text","text":"ok","__proto__":{"polluted":true}}') },
      { name: 'deep provider wrapper', view: deep },
      { name: 'oversized HTML', view: { type: 'html', summary: 'View', html: 'x'.repeat(8193) } },
      { name: 'script source URL', view: { type: 'sources', items: [{ label: 'link', url: 'javascript:alert(1)' }] } },
    ].map(row => ({ name: row.name, run: () => expect(checkedBotView({ view: row.view })).toBeUndefined() })))
  })

  it('keeps calculator values local and validates only declared inputs at submission', async () => {
    const view = checkedBotView({ title: 'Calculator', view: calculator() })!
    expect(view).toBeDefined()
    expect(resolve({ '=': 'total' }, viewScope(view))).toBe(24)
    expect(resolve({ '=': 'total' }, viewScope(view, { qty: 3 }))).toBe(36)
    await runScenarios([
      { name: 'declared input', action: 'send', inputs: { qty: 3 }, allowed: true },
      { name: 'default input', action: 'send', inputs: {}, allowed: true },
      { name: 'out of range', action: 'send', inputs: { qty: 99 }, allowed: false },
      { name: 'nonfinite', action: 'send', inputs: { qty: NaN }, allowed: false },
      { name: 'unknown input', action: 'send', inputs: { other: 3 }, allowed: false },
      { name: 'unknown action', action: 'other', inputs: { qty: 3 }, allowed: false },
    ].map(row => ({ name: row.name, run: () => expect(validateViewAnswer(view, row.action, { inputs: row.inputs }).error === undefined).toBe(row.allowed) })))
    // No local edit changes the Host blueprint's initial values.
    expect(resolve({ '=': 'total' }, viewScope(view))).toBe(24)
  })

  it('accepts deep-view v0.4 extensions including form fields/cancelLabel, shorthand options, chart.data, and markdown text/callout', () => {
    const view = checkedBotView({
      title: 'v0.4 View',
      view: {
        type: 'stack',
        children: [
          { type: 'text', title: 'Summary', text: '**Ready**', markdown: true, tone: 'info' },
          { type: 'callout', title: 'Heads up', text: 'Use *safe* mode', tone: 'good', markdown: true },
          { type: 'choice', id: 'mode', label: 'Mode', options: ['Fast', 'Thorough'] },
          { type: 'options', id: 'picks', options: ['Alpha', 'Beta'], submitLabel: 'Go' },
          {
            type: 'chart',
            kind: 'bar',
            categories: ['Mon', 'Tue'],
            series: [{ name: 'Calls', data: ['3', '5'] }],
          },
          {
            type: 'form',
            id: 'details',
            submitLabel: 'Save',
            cancelLabel: 'Dismiss',
            fields: [
              { id: 'notes', label: 'Notes', value: 'initial', multiline: true, readOnly: false, kind: 'text', required: true },
            ],
          },
        ],
      },
    })!
    expect(view).toBeDefined()
    expect(validateViewAnswer(view, 'picks', { inputs: { mode: 'Fast' }, selected: ['Beta'] })).toEqual({
      selected: ['Beta'],
      inputs: { mode: 'Fast' },
    })
    expect(validateViewAnswer(view, 'details', { inputs: { mode: 'Thorough' }, fields: { notes: 'updated' } })).toEqual({
      fields: { notes: 'updated' },
      inputs: { mode: 'Thorough' },
    })
  })
})
