import { describe, expect, it } from 'vitest'
import type { ChatItem, ToolActivity } from '../src/types'
import { placeUiArtifacts, projectUiArtifacts } from '../src/state/ui-artifacts'
import { chatSections } from '../src/state/message-helpers'
import { foldHistory } from '../src/state/event-reducer'
import { INTELLIGENT_UI_RENDERER_CODE } from '../src/generated/intelligent-ui-renderer-code'

function tool(
  id: string,
  toolKey: string,
  seq: number,
  argumentsObject: unknown,
  meta: unknown,
  state: ToolActivity['state'] = 'finished',
  sessionId = 's1',
): ToolActivity {
  return {
    kind: 'tool',
    id,
    sessionId,
    toolName: toolKey,
    toolKey,
    nativeSeq: seq,
    nativeRevisionSeq: seq,
    createdAt: seq,
    turn: String(Math.floor(seq / 10)),
    state,
    arguments: JSON.stringify(argumentsObject),
    uiResultMeta: meta,
  }
}

const tree = {
  title: 'Counter',
  root: 'root',
  components: [
    { id: 'root', type: 'Card', children: ['stat'] },
    { id: 'stat', type: 'Stat', props: { label: 'Count', value: 1 } },
  ],
}

const patch = {
  uiId: 'ui-1',
  baseVersion: 1,
  ops: [{ op: 'setProps', id: 'stat', props: { value: 2 } }],
}

const snapshot = {
  ...tree,
  uiId: 'ui-1',
  version: 2,
  components: [
    tree.components[0],
    { ...tree.components[1], props: { label: 'Count', value: 2 } },
  ],
}

const snapshotV3 = {
  ...tree,
  uiId: 'ui-1',
  version: 3,
  components: [
    tree.components[0],
    { ...tree.components[1], props: { label: 'Count', value: 3 } },
  ],
}

describe('portable UI artifact projection (Issue #124 & #126)', () => {
  it('keeps a single actionable owner across queue-split turns, patches and paged recovery', () => {
    const message = (id: string, role: 'user' | 'assistant', turn?: string): ChatItem => ({
      kind: 'message', id, role, turn, sessionId: 's1', text: id, createdAt: 0,
    })
    const intro = message('intro', 'assistant', '1')
    const queue = message('queued', 'user')
    const render = tool('ui-1', 'ui_render', 11, tree, { ok: true })
    const patchSameTurn = tool('patch-1', 'ui_patch', 12, patch, { ok: true, ui: snapshot })
    const patchLaterTurn = tool('patch-1', 'ui_patch', 21, patch, { ok: true, ui: snapshot })
    const cases = [
      { name: 'queued before creating tool', rows: [intro, queue, render], owner: render.id, pointers: 0 },
      { name: 'same-turn patch after queue', rows: [render, queue, patchSameTurn], owner: render.id, pointers: 0 },
      { name: 'paged-out render', rows: [intro, queue, patchSameTurn], owner: patchSameTurn.id, pointers: 0 },
      { name: 'split later patch turn', rows: [render, patchLaterTurn, queue, message('tail', 'assistant', '2')], owner: render.id, pointers: 1 },
    ]
    for (const { name, rows, owner, pointers } of cases) {
      const sections = chatSections(rows)
      const artifacts = projectUiArtifacts(rows, 'hostA', 's1')
      const placed = placeUiArtifacts(artifacts, sections)
      const owners = [...placed.entries()].filter(([, value]) => value.cards.length > 0)
      expect(owners, name).toHaveLength(1)
      expect(owners[0]?.[1].cards, name).toHaveLength(1)
      expect(owners[0]?.[0], name).toBe(sections.find(section => section.kind === 'process'
        && section.items.some(item => item.id === owner))?.key)
      expect([...placed.values()].flatMap(value => value.pointers), name).toHaveLength(pointers)
      // More streamed output in another segment cannot create a second sender.
      const continued = placeUiArtifacts(artifacts, chatSections([...rows, message('another-queue', 'user'), message('continued', 'assistant', '1')]))
      expect([...continued.entries()].filter(([, value]) => value.cards.length > 0).map(([key]) => key), name)
        .toEqual(owners.map(([key]) => key))
    }
  })

  it('restores the latest full snapshot, never failed, stale or interrupted patches', () => {
    const rows: ChatItem[] = [
      tool('ui-1', 'ui_render', 1, tree, { ok: true }),
      tool('bad', 'ui_patch', 10, patch, { ok: false, ui: snapshot }),
      tool('patch-1', 'ui_patch', 20, patch, { ok: true, ui: snapshot }),
      tool('stale', 'ui_patch', 30, patch, { ok: true, ui: { ...snapshot, version: 3 } }),
      tool('stopped', 'ui_patch', 40, { ...patch, baseVersion: 2 }, { ok: true, ui: { ...snapshot, version: 3 } }, 'failed'),
    ]
    const out = projectUiArtifacts(rows, 'hostA', 's1')
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({
      uiId: 'ui-1',
      version: 2,
      hostId: 'hostA',
      sessionId: 's1',
      definition: snapshot,
      turn: '0',
      updatedTurn: '2',
    })
    expect(projectUiArtifacts(rows.filter(t => t.id !== 'patch-1'), 'hostA', 's1')[0]?.version).toBe(1)
  })

  it('recovers artifact from verified full Patch snapshot when ui_render is paged out', () => {
    // History pagination boundary: ui_render was 100 turns ago and not loaded in current items.
    // Only ui_patch v2 is present in the current history window.
    const pagedRows: ChatItem[] = [
      tool('patch-1', 'ui_patch', 50, patch, { ok: true, ui: snapshot }),
    ]
    const recovered = projectUiArtifacts(pagedRows, 'hostA', 's1')
    expect(recovered).toHaveLength(1)
    expect(recovered[0]).toMatchObject({
      uiId: 'ui-1',
      version: 2,
      hostId: 'hostA',
      sessionId: 's1',
      definition: snapshot,
      turn: '5',
      updatedTurn: '5',
    })

    // When user scrolls up and loads older page containing ui_render:
    const fullHistory: ChatItem[] = [
      tool('ui-1', 'ui_render', 5, tree, { ok: true }),
      ...pagedRows,
    ]
    const reanchored = projectUiArtifacts(fullHistory, 'hostA', 's1')
    expect(reanchored).toHaveLength(1)
    expect(reanchored[0]).toMatchObject({
      uiId: 'ui-1',
      version: 2,
      turn: '0', // Re-anchored to the original ui_render turn
      updatedTurn: '5', // Retains latest patch turn
    })
  })

  it('handles multiple patches in paged history and advances across missing intermediate patches', () => {
    // History contains patch v2 and patch v3 without initial ui_render
    const patchV3Call = { uiId: 'ui-1', baseVersion: 2, ops: [] }
    const rows: ChatItem[] = [
      tool('patch-1', 'ui_patch', 20, patch, { ok: true, ui: snapshot }),
      tool('patch-2', 'ui_patch', 30, patchV3Call, { ok: true, ui: snapshotV3 }),
    ]
    const out = projectUiArtifacts(rows, 'hostA', 's1')
    expect(out[0]?.version).toBe(3)
    expect(out[0]?.updatedTurn).toBe('3')

    // History gap: ui_render (v1) and patch v3 (v2 was missed in history)
    const gapRows: ChatItem[] = [
      tool('ui-1', 'ui_render', 1, tree, { ok: true }),
      tool('patch-2', 'ui_patch', 30, patchV3Call, { ok: true, ui: snapshotV3 }),
    ]
    const gapOut = projectUiArtifacts(gapRows, 'hostA', 's1')
    expect(gapOut[0]?.version).toBe(3)
    expect(gapOut[0]?.turn).toBe('0')
    expect(gapOut[0]?.updatedTurn).toBe('3')
  })

  it('rejects stale, duplicate, or corrupted snapshots without mutating current artifact', () => {
    const rows: ChatItem[] = [
      tool('ui-1', 'ui_render', 1, tree, { ok: true }),
      tool('patch-1', 'ui_patch', 20, patch, { ok: true, ui: snapshot }),
    ]
    const base = projectUiArtifacts(rows, 'hostA', 's1')
    expect(base[0]?.version).toBe(2)

    // 1. Duplicate patch (same baseVersion 1)
    const withDuplicate = [...rows, tool('patch-dup', 'ui_patch', 25, patch, { ok: true, ui: snapshot })]
    expect(projectUiArtifacts(withDuplicate, 'hostA', 's1')[0]?.version).toBe(2)

    // 2. Corrupted snapshot: missing root
    const corruptRoot = { ...snapshotV3, root: 'nonexistent' }
    const withCorruptRoot = [...rows, tool('p-corrupt', 'ui_patch', 30, { uiId: 'ui-1', baseVersion: 2 }, { ok: true, ui: corruptRoot })]
    expect(projectUiArtifacts(withCorruptRoot, 'hostA', 's1')[0]?.version).toBe(2)

    // 3. Corrupted snapshot: duplicate component IDs
    const duplicateIds = {
      ...snapshotV3,
      components: [
        { id: 'root', type: 'Card' },
        { id: 'root', type: 'Card' },
      ],
    }
    const withDupIds = [...rows, tool('p-dupids', 'ui_patch', 30, { uiId: 'ui-1', baseVersion: 2 }, { ok: true, ui: duplicateIds })]
    expect(projectUiArtifacts(withDupIds, 'hostA', 's1')[0]?.version).toBe(2)

    // 4. Mismatched uiId
    const withMismatchId = [...rows, tool('p-mismatch', 'ui_patch', 30, { uiId: 'ui-1', baseVersion: 2 }, { ok: true, ui: { ...snapshotV3, uiId: 'other' } })]
    expect(projectUiArtifacts(withMismatchId, 'hostA', 's1')[0]?.version).toBe(2)

    // 5. Version increment mismatch (baseVersion: 2, but snapshot claims version: 5)
    const withBadVersion = [...rows, tool('p-badver', 'ui_patch', 30, { uiId: 'ui-1', baseVersion: 2 }, { ok: true, ui: { ...snapshotV3, version: 5 } })]
    expect(projectUiArtifacts(withBadVersion, 'hostA', 's1')[0]?.version).toBe(2)
  })

  it('replays out-of-order result rows by native sequence and isolates sessions', () => {
    const events = [
      tool('patch-1', 'ui_patch', 10, patch, { ok: true, ui: snapshot }),
      tool('ui-1', 'ui_render', 1, tree, { ok: true }),
    ]
    expect(projectUiArtifacts(events, 'hostA', 's1')[0]?.version).toBe(2)
    expect(projectUiArtifacts(events, 'hostB', 's1')[0]?.hostId).toBe('hostB')
    expect(projectUiArtifacts(events, 'hostA', 's2')).toEqual([])
  })

  it('retains complete Host meta from history despite ordinary tool-detail truncation', () => {
    const giant = 'x'.repeat(100_000)
    const items = foldHistory([
      {
        event: {
          type: 'tool/call',
          seq: 1,
          time: 10,
          data: { turn: 1, callId: 'ui-1', name: 'ui_render', arguments: JSON.stringify(tree) },
        },
      },
      {
        event: {
          type: 'tool/result',
          seq: 2,
          time: 20,
          data: {
            turn: 1,
            message: { source: { callId: 'ui-1' }, content: [{ type: 'text', text: giant }] },
            meta: { ok: true, policy: { allowNetwork: false } },
          },
        },
      },
    ], 's1')
    expect(projectUiArtifacts(items, 'hostA', 's1')[0]).toMatchObject({
      definition: tree,
      policy: { allowNetwork: false },
    })
  })

  it('does not reuse successful UI metadata after a later result omits it or fails', () => {
    const call = {
      event: { type: 'tool/call', seq: 1, time: 10,
        data: { turn: 1, callId: 'ui-1', name: 'ui_render', arguments: JSON.stringify(tree) } },
    }
    const result = {
      event: { type: 'tool/result', seq: 2, time: 20,
        data: { turn: 1, message: { source: { callId: 'ui-1' }, content: [] }, meta: { ok: true } } },
    }
    expect(projectUiArtifacts(foldHistory([call, result], 's1'), 'hostA', 's1')).toHaveLength(1)
    for (const isError of [false, true]) {
      const final = {
        event: { type: 'tool/result', seq: 3, time: 30,
          data: { turn: 1, message: { source: { callId: 'ui-1' }, content: [], isError } } },
      }
      expect(projectUiArtifacts(foldHistory([call, result, final], 's1'), 'hostA', 's1')).toEqual([])
    }
  })

  it('rejects metadata-less results, oversized payloads and cross-kind patch attempts', () => {
    const rows = [
      tool('ui-1', 'ui_render', 1, tree, undefined),
      tool('huge', 'ui_render', 2, { ...tree, extra: 'x'.repeat(480_001) }, { ok: true }),
      tool('widget', 'ui_render_widget', 3, { html: '<div>Hello</div>', jsFunctions: 'evil()' }, { ok: true }),
    ]
    expect(projectUiArtifacts(rows, 'hostA', 's1')).toMatchObject([{ kind: 'widget', uiId: 'widget' }])
    const invalid = tool('invalid', 'ui_patch', 4, { ...patch, uiId: 'widget' }, { ok: true, ui: snapshot })
    expect(projectUiArtifacts([...rows, invalid], 'hostA', 's1')[0]?.version).toBe(1)
  })

  it('verifies bundled offline renderer code exports and interface when enabled', () => {
    // If renderer code is bundled, verify that it contains the expected entry points
    if (INTELLIGENT_UI_RENDERER_CODE) {
      expect(INTELLIGENT_UI_RENDERER_CODE).toContain('DshIntelligentUiRenderer')
      expect(INTELLIGENT_UI_RENDERER_CODE).toContain('mount')
      expect(INTELLIGENT_UI_RENDERER_CODE).toContain('render')
      expect(INTELLIGENT_UI_RENDERER_CODE).toContain('dispose')
      expect(INTELLIGENT_UI_RENDERER_CODE.length).toBeGreaterThan(50_000)
    } else {
      expect(INTELLIGENT_UI_RENDERER_CODE).toBe('')
    }
  })

  it('supports modern Table properties, dataRef and componentVersion (Issue #246)', () => {
    const modernTableTree = {
      title: 'Benchmarks',
      root: 'tbl',
      components: [
        {
          id: 'tbl',
          type: 'Table',
          componentVersion: '1.0.0',
          props: {
            columns: ['Algorithm', 'Time (ms)', 'Comparisons'],
            rows: [
              ['QuickSort', 83.4, 733160],
              ['MergeSort', 95.1, 650000],
            ],
            sortable: true,
            searchable: true,
            filterable: true,
            pageSize: 10,
            exportable: true,
            columnTypes: ['text', 'number', 'number'],
          },
        },
      ],
    }

    const modernDataRefTree = {
      title: 'DataRef Table',
      root: 'tbl',
      components: [
        {
          id: 'tbl',
          type: 'Table',
          props: {
            dataRef: { scope: 's1', id: 'd1' },
            pageSize: 20,
            exportable: true,
          },
        },
      ],
    }

    const rows = [
      tool('ui-modern-table', 'ui_render', 1, modernTableTree, { ok: true }),
      tool('ui-dataref-table', 'ui_render', 2, modernDataRefTree, { ok: true }),
    ]

    const artifacts = projectUiArtifacts(rows, 'hostA', 's1')
    expect(artifacts).toHaveLength(2)
    expect(artifacts[0]).toMatchObject({
      uiId: 'ui-modern-table',
      version: 1,
      definition: modernTableTree,
    })
    expect(artifacts[1]).toMatchObject({
      uiId: 'ui-dataref-table',
      version: 1,
      definition: modernDataRefTree,
    })

    if (INTELLIGENT_UI_RENDERER_CODE) {
      // Bundled renderer must contain modern Table capabilities and detailed errors
      expect(INTELLIGENT_UI_RENDERER_CODE).toContain('searchable')
      expect(INTELLIGENT_UI_RENDERER_CODE).toContain('filterable')
      expect(INTELLIGENT_UI_RENDERER_CODE).toContain('pageSize')
      expect(INTELLIGENT_UI_RENDERER_CODE).toContain('columnTypes')
      expect(INTELLIGENT_UI_RENDERER_CODE).toContain('componentVersion')
      expect(INTELLIGENT_UI_RENDERER_CODE).toContain('Unsupported or invalid UI definition')
    }
  })

  it('projects and places ui_compose composite UI artifacts (Issue #271)', () => {
    const compositionTree = {
      title: 'Quarterly Report',
      blocks: [
        { id: 'intro', type: 'markdown', text: '## Q3 Summary\nKey figures below.' },
        {
          id: 'kpi-stat',
          type: 'catalog',
          title: 'KPIs',
          root: 'r',
          components: [
            { id: 'r', type: 'Stack', children: ['stat1'] },
            { id: 'stat1', type: 'Stat', props: { label: 'Revenue', value: '$1.2M' } },
          ],
        },
        { id: 'notes', type: 'markdown', text: 'Detailed discussion follows.' },
        { id: 'demo', type: 'widget', title: 'Live 3D View', html: '<div>3D Scene</div>' },
      ],
    }

    const composeTool = tool('comp-1', 'ui_compose', 11, compositionTree, { ok: true, policy: { maxHeight: 3200 } })
    const artifacts = projectUiArtifacts([composeTool], 'hostA', 's1')
    expect(artifacts).toHaveLength(1)
    expect(artifacts[0]).toMatchObject({
      kind: 'composition',
      hostId: 'hostA',
      sessionId: 's1',
      uiId: 'comp-1',
      version: 1,
      title: 'Quarterly Report',
      turn: '1',
      originSeq: 11,
      policy: { maxHeight: 3200 },
      definition: compositionTree,
    })

    // Placing artifact in chat section
    const sections = chatSections([
      { kind: 'message', id: 'm1', role: 'user', sessionId: 's1', text: 'Show report', createdAt: 1 },
      composeTool,
    ])
    const placed = placeUiArtifacts(artifacts, sections)
    const owners = [...placed.entries()].filter(([, value]) => value.cards.length > 0)
    expect(owners).toHaveLength(1)
    expect(owners[0]?.[1].cards[0]?.uiId).toBe('comp-1')

    // History folding retains ui_compose result metadata
    const folded = foldHistory([
      {
        event: {
          type: 'tool/call',
          seq: 1,
          time: 10,
          data: { turn: 1, callId: 'comp-1', name: 'ui_compose', arguments: JSON.stringify(compositionTree) },
        },
      },
      {
        event: {
          type: 'tool/result',
          seq: 2,
          time: 20,
          data: {
            turn: 1,
            message: { source: { callId: 'comp-1' }, content: [{ type: 'text', text: 'rendered' }] },
            meta: { ok: true },
          },
        },
      },
    ], 's1')
    expect(projectUiArtifacts(folded, 'hostA', 's1')[0]).toMatchObject({
      kind: 'composition',
      uiId: 'comp-1',
      version: 1,
    })
  })

  it('supports composition block-level ui_patch targeting <compositionId>#<blockId> (Issue #271)', () => {
    const compositionTree = {
      title: 'Analysis',
      blocks: [
        { id: 'intro', type: 'markdown', text: 'Intro text' },
        {
          id: 'kpi',
          type: 'catalog',
          title: 'KPIs',
          root: 'r',
          components: [
            { id: 'r', type: 'Card', children: ['stat'] },
            { id: 'stat', type: 'Stat', props: { label: 'Count', value: 10 } },
          ],
        },
        { id: 'demo', type: 'widget', title: 'Widget', html: '<div>Widget</div>' },
      ],
    }

    const blockPatchCall = {
      uiId: 'comp-1#kpi',
      baseVersion: 1,
      ops: [{ op: 'setProps', id: 'stat', props: { value: 20 } }],
    }
    const blockSnapshotV2 = {
      uiId: 'comp-1#kpi',
      version: 2,
      title: 'Updated KPIs',
      root: 'r',
      components: [
        { id: 'r', type: 'Card', children: ['stat'] },
        { id: 'stat', type: 'Stat', props: { label: 'Count', value: 20 } },
      ],
    }

    const rows: ChatItem[] = [
      tool('comp-1', 'ui_compose', 10, compositionTree, { ok: true }),
      tool('patch-1', 'ui_patch', 20, blockPatchCall, { ok: true, ui: blockSnapshotV2 }),
    ]

    const artifacts = projectUiArtifacts(rows, 'hostA', 's1')
    expect(artifacts).toHaveLength(1)
    const updated = artifacts[0]!
    expect(updated.kind).toBe('composition')
    expect(updated.uiId).toBe('comp-1')
    expect(updated.version).toBe(2)
    expect(updated.turn).toBe('1')
    expect(updated.updatedTurn).toBe('2')

    // Verify catalog block was updated in place while markdown and widget remain untouched
    const blocks = updated.definition.blocks as any[]
    expect(blocks).toHaveLength(3)
    expect(blocks[0]).toEqual({ id: 'intro', type: 'markdown', text: 'Intro text' })
    expect(blocks[1]).toEqual({
      id: 'kpi',
      type: 'catalog',
      title: 'Updated KPIs',
      root: 'r',
      components: blockSnapshotV2.components,
    })
    expect(blocks[2]).toEqual({ id: 'demo', type: 'widget', title: 'Widget', html: '<div>Widget</div>' })

    // Verify placement produces pointer in turn 2
    const sections = chatSections([
      { kind: 'message', id: 'm1', role: 'assistant', turn: '1', sessionId: 's1', text: 'T1', createdAt: 1 },
      rows[0]!,
      { kind: 'message', id: 'm2', role: 'assistant', turn: '2', sessionId: 's1', text: 'T2', createdAt: 2 },
      rows[1]!,
    ])
    const placed = placeUiArtifacts(artifacts, sections)
    const t2Section = sections.find(s => s.kind === 'process' && s.turn === '2')
    expect(placed.get(t2Section!.key)?.pointers).toHaveLength(1)
    expect(placed.get(t2Section!.key)?.pointers[0]?.uiId).toBe('comp-1')
  })

  it('supports sequential patches across multiple catalog blocks and enforces block version monotonic check (Issue #271)', () => {
    const compositionTree = {
      title: 'Multi-Block Dashboard',
      blocks: [
        {
          id: 'chart-block',
          type: 'catalog',
          root: 'chart-root',
          components: [{ id: 'chart-root', type: 'Card', children: [] }],
        },
        {
          id: 'table-block',
          type: 'catalog',
          root: 'tbl-root',
          components: [{ id: 'tbl-root', type: 'Card', children: [] }],
        },
      ],
    }

    const chartSnapshotV2 = {
      uiId: 'comp-multi#chart-block',
      version: 2,
      root: 'chart-root',
      components: [{ id: 'chart-root', type: 'Card', children: ['stat'] }, { id: 'stat', type: 'Stat', props: { label: 'A', value: 1 } }],
    }
    const tableSnapshotV2 = {
      uiId: 'comp-multi#table-block',
      version: 2,
      root: 'tbl-root',
      components: [{ id: 'tbl-root', type: 'Card', children: ['stat2'] }, { id: 'stat2', type: 'Stat', props: { label: 'B', value: 2 } }],
    }
    const chartSnapshotV3 = {
      uiId: 'comp-multi#chart-block',
      version: 3,
      root: 'chart-root',
      components: [{ id: 'chart-root', type: 'Card', children: ['stat'] }, { id: 'stat', type: 'Stat', props: { label: 'A', value: 99 } }],
    }

    const rows: ChatItem[] = [
      tool('comp-multi', 'ui_compose', 10, compositionTree, { ok: true }),
      // Patch chart block (v1 -> v2)
      tool('p1', 'ui_patch', 20, { uiId: 'comp-multi#chart-block', baseVersion: 1 }, { ok: true, ui: chartSnapshotV2 }),
      // Patch table block (v1 -> v2)
      tool('p2', 'ui_patch', 30, { uiId: 'comp-multi#table-block', baseVersion: 1 }, { ok: true, ui: tableSnapshotV2 }),
      // Patch chart block again (v2 -> v3)
      tool('p3', 'ui_patch', 40, { uiId: 'comp-multi#chart-block', baseVersion: 2 }, { ok: true, ui: chartSnapshotV3 }),
    ]

    const out = projectUiArtifacts(rows, 'hostA', 's1')
    expect(out[0]?.version).toBe(4) // 1 initial + 3 block patches
    const finalBlocks = out[0]?.definition.blocks as any[]
    expect(finalBlocks[0].components).toEqual(chartSnapshotV3.components)
    expect(finalBlocks[1].components).toEqual(tableSnapshotV2.components)

    // Stale patch rejection: duplicate baseVersion 1 for chart block
    const withStale = [...rows, tool('p-stale', 'ui_patch', 50, { uiId: 'comp-multi#chart-block', baseVersion: 1 }, { ok: true, ui: chartSnapshotV2 })]
    expect(projectUiArtifacts(withStale, 'hostA', 's1')[0]?.version).toBe(4)

    // Invalid target block: patch non-existent block
    const withInvalidBlock = [...rows, tool('p-ghost', 'ui_patch', 50, { uiId: 'comp-multi#nonexistent', baseVersion: 1 }, { ok: true, ui: chartSnapshotV2 })]
    expect(projectUiArtifacts(withInvalidBlock, 'hostA', 's1')[0]?.version).toBe(4)
  })

  it('rejects malformed or invalid composition definitions and patch attempts (Issue #271)', () => {
    // 1. Empty blocks array
    const emptyBlocks = { title: 'T', blocks: [] }
    expect(projectUiArtifacts([tool('bad1', 'ui_compose', 1, emptyBlocks, { ok: true })], 'hostA', 's1')).toEqual([])

    // 2. Duplicate block IDs
    const duplicateBlockIds = {
      blocks: [
        { id: 'blk1', type: 'markdown', text: 'A' },
        { id: 'blk1', type: 'markdown', text: 'B' },
      ],
    }
    expect(projectUiArtifacts([tool('bad2', 'ui_compose', 2, duplicateBlockIds, { ok: true })], 'hostA', 's1')).toEqual([])

    // 3. Invalid block ID syntax (starts with digit or special char)
    const invalidId = {
      blocks: [{ id: '123bad', type: 'markdown', text: 'Hello' }],
    }
    expect(projectUiArtifacts([tool('bad3', 'ui_compose', 3, invalidId, { ok: true })], 'hostA', 's1')).toEqual([])

    // 4. Unknown block type
    const unknownType = {
      blocks: [{ id: 'b1', type: 'future_audio_canvas', text: 'Hello' }],
    }
    expect(projectUiArtifacts([tool('bad4', 'ui_compose', 4, unknownType, { ok: true })], 'hostA', 's1')).toEqual([])

    // 5. Empty markdown text
    const emptyText = {
      blocks: [{ id: 'b1', type: 'markdown', text: '   ' }],
    }
    expect(projectUiArtifacts([tool('bad5', 'ui_compose', 5, emptyText, { ok: true })], 'hostA', 's1')).toEqual([])

    // 6. Catalog block with invalid tree (missing root in components)
    const badCatalogTree = {
      blocks: [
        { id: 'c1', type: 'catalog', root: 'missing', components: [{ id: 'other', type: 'Card' }] },
      ],
    }
    expect(projectUiArtifacts([tool('bad6', 'ui_compose', 6, badCatalogTree, { ok: true })], 'hostA', 's1')).toEqual([])

    // 7. Widget block with empty html
    const badWidget = {
      blocks: [{ id: 'w1', type: 'widget', html: '' }],
    }
    expect(projectUiArtifacts([tool('bad7', 'ui_compose', 7, badWidget, { ok: true })], 'hostA', 's1')).toEqual([])

    // 8. Patching non-catalog block in composition
    const validComp = {
      blocks: [
        { id: 'md1', type: 'markdown', text: 'Prose' },
      ],
    }
    const rows = [
      tool('comp-md', 'ui_compose', 10, validComp, { ok: true }),
      tool('p-bad', 'ui_patch', 20, { uiId: 'comp-md#md1', baseVersion: 1 }, {
        ok: true,
        ui: { uiId: 'comp-md#md1', version: 2, root: 'r', components: [{ id: 'r', type: 'Card' }] },
      }),
    ]
    expect(projectUiArtifacts(rows, 'hostA', 's1')[0]?.version).toBe(1)
  })
})
