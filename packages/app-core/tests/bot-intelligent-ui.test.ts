import { describe, expect, it } from 'vitest'
import type { ChatItem, ToolActivity } from '../src/types'
import { placeUiArtifacts, projectUiArtifacts } from '../src/state/ui-artifacts'
import { chatSections } from '../src/state/message-helpers'
import { processSegments } from '../src/screens/chat-process'
import { botMessageRequest } from '../src/services/bot-catalog'

function tool(
  id: string,
  toolKey: string,
  seq: number,
  argumentsObject: unknown,
  meta: unknown,
  state: ToolActivity['state'] = 'finished',
  sessionId = 'bot-session-1',
  turn = 'turn-1',
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
    turn,
    state,
    arguments: JSON.stringify(argumentsObject),
    uiResultMeta: meta,
  }
}

const tableTree = {
  title: 'Sales Report',
  root: 'table-root',
  components: [
    {
      id: 'table-root',
      type: 'Table',
      props: {
        searchable: true,
        sortable: true,
        pageSize: 10,
        columns: [
          { key: 'item', label: 'Item' },
          { key: 'amount', label: 'Amount' },
        ],
        rows: [
          { item: 'Widget A', amount: 100 },
          { item: 'Widget B', amount: 200 },
        ],
      },
    },
  ],
}

const patchTable = {
  uiId: 'table-ui-1',
  baseVersion: 1,
  ops: [{ op: 'setProps', id: 'table-root', props: { pageSize: 20 } }],
}

const firstComp = tableTree.components[0]!
const tableSnapshotV2 = {
  ...tableTree,
  uiId: 'table-ui-1',
  version: 2,
  components: [
    {
      ...firstComp,
      props: {
        ...firstComp.props,
        pageSize: 20,
      },
    },
  ],
}

describe('[Feature][Android Bot Mode] Intelligent UI Support (Issue #260)', () => {
  it('projects and places ui_render table artifact in bot conversation turn', () => {
    const userMsg: ChatItem = {
      kind: 'message',
      id: 'm1',
      role: 'user',
      sessionId: 'bot-session-1',
      text: '请生成销售表格',
      createdAt: 100,
      turn: 'turn-1',
    }
    const renderTool = tool('table-ui-1', 'ui_render', 101, tableTree, { ok: true }, 'finished', 'bot-session-1', 'turn-1')
    const botReply: ChatItem = {
      kind: 'message',
      id: 'm2',
      role: 'assistant',
      sessionId: 'bot-session-1',
      text: '以下是本季度的销售数据表格：',
      createdAt: 102,
      turn: 'turn-1',
    }

    const messages = [userMsg, renderTool, botReply]
    const sections = chatSections(messages)
    const artifacts = projectUiArtifacts(messages, 'host-1', 'bot-session-1')

    expect(artifacts).toHaveLength(1)
    expect(artifacts[0]).toMatchObject({
      kind: 'declarative',
      uiId: 'table-ui-1',
      version: 1,
      title: 'Sales Report',
      sessionId: 'bot-session-1',
    })

    const placed = placeUiArtifacts(artifacts, sections)
    const processSection = sections.find(s => s.kind === 'process')
    expect(processSection).toBeDefined()
    expect(placed.get(processSection!.key)?.cards).toHaveLength(1)
    expect(placed.get(processSection!.key)?.cards[0]?.uiId).toBe('table-ui-1')

    // Verify turn-inline positioning with processSegments
    if (processSection && processSection.kind === 'process') {
      const segments = processSegments(processSection.items)
      const lastResponseIndex = segments.map(s => s.kind).lastIndexOf('response')
      expect(lastResponseIndex).toBeGreaterThanOrEqual(0)
      expect(segments[lastResponseIndex]?.kind).toBe('response')
    }
  })

  it('handles response-less bot turn by rendering card as standalone item', () => {
    // Model calls ui_render without generating text response
    const renderTool = tool('table-ui-1', 'ui_render', 101, tableTree, { ok: true }, 'finished', 'bot-session-1', 'turn-1')
    const messages = [renderTool]
    const sections = chatSections(messages)
    const artifacts = projectUiArtifacts(messages, 'host-1', 'bot-session-1')

    expect(artifacts).toHaveLength(1)
    const placed = placeUiArtifacts(artifacts, sections)
    const processSection = sections.find(s => s.kind === 'process')
    expect(processSection).toBeDefined()
    expect(placed.get(processSection!.key)?.cards).toHaveLength(1)

    if (processSection && processSection.kind === 'process') {
      const segments = processSegments(processSection.items)
      const lastResponseIndex = segments.map(s => s.kind).lastIndexOf('response')
      expect(lastResponseIndex).toBe(-1)
    }
  })

  it('advances artifact version and produces pointer in bot conversation upon ui_patch', () => {
    const renderTool = tool('table-ui-1', 'ui_render', 101, tableTree, { ok: true }, 'finished', 'bot-session-1', 'turn-1')
    const botReply1: ChatItem = {
      kind: 'message',
      id: 'm1',
      role: 'assistant',
      sessionId: 'bot-session-1',
      text: '这是初始表格',
      createdAt: 102,
      turn: 'turn-1',
    }
    const patchTool = tool('patch-1', 'ui_patch', 201, patchTable, { ok: true, ui: tableSnapshotV2 }, 'finished', 'bot-session-1', 'turn-2')
    const botReply2: ChatItem = {
      kind: 'message',
      id: 'm2',
      role: 'assistant',
      sessionId: 'bot-session-1',
      text: '已将分页调整为 20 条',
      createdAt: 202,
      turn: 'turn-2',
    }

    const messages = [renderTool, botReply1, patchTool, botReply2]
    const sections = chatSections(messages)
    const artifacts = projectUiArtifacts(messages, 'host-1', 'bot-session-1')

    expect(artifacts).toHaveLength(1)
    expect(artifacts[0]?.version).toBe(2)
    expect(artifacts[0]?.updatedTurn).toBe('turn-2')

    const placed = placeUiArtifacts(artifacts, sections)
    const turn1Section = sections.find(s => s.kind === 'process' && s.turn === 'turn-1')
    const turn2Section = sections.find(s => s.kind === 'process' && s.turn === 'turn-2')

    expect(turn1Section).toBeDefined()
    expect(turn2Section).toBeDefined()

    // Original card stays anchored to turn-1
    expect(placed.get(turn1Section!.key)?.cards).toHaveLength(1)
    expect(placed.get(turn1Section!.key)?.cards[0]?.version).toBe(2)

    // Turn-2 receives an update pointer
    expect(placed.get(turn2Section!.key)?.pointers).toHaveLength(1)
    expect(placed.get(turn2Section!.key)?.pointers[0]?.uiId).toBe('table-ui-1')
    expect(placed.get(turn2Section!.key)?.pointers[0]?.version).toBe(2)
  })

  it('isolates artifacts across different bot sessions and respects hidden exchange turns', () => {
    const bot1Tool = tool('ui-bot-1', 'ui_render', 101, tableTree, { ok: true }, 'finished', 'bot-session-1', 'turn-1')
    const bot2Tool = tool('ui-bot-2', 'ui_render', 201, tableTree, { ok: true }, 'finished', 'bot-session-2', 'turn-1')
    const hiddenExchangeTool = tool('ui-hidden', 'ui_render', 301, tableTree, { ok: true }, 'finished', 'bot-session-1', 'turn-hidden')

    // Querying for bot-session-1 ignores bot-session-2
    const bot1Artifacts = projectUiArtifacts([bot1Tool, bot2Tool], 'host-1', 'bot-session-1')
    expect(bot1Artifacts.map(a => a.uiId)).toEqual(['ui-bot-1'])

    // Hidden turn filtering (simulate exchangeTurns)
    const hiddenTurns = new Set(['turn-hidden'])
    const messages = [bot1Tool, hiddenExchangeTool]
    const visibleMessages = messages.filter(item => !(item.turn !== undefined && hiddenTurns.has(item.turn)))
    expect(visibleMessages).toHaveLength(1)
    expect(visibleMessages[0]?.id).toBe('ui-bot-1')

    const visibleSections = chatSections(visibleMessages)
    const placed = placeUiArtifacts(projectUiArtifacts(visibleMessages, 'host-1', 'bot-session-1'), visibleSections)
    const allPlacedCards = [...placed.values()].flatMap(v => v.cards)
    expect(allPlacedCards.map(c => c.uiId)).toEqual(['ui-bot-1'])
  })

  it('prevents hidden exchange turn patches from mutating visible cards', () => {
    // Visible turn-1 renders card v1
    const renderTool = tool('table-ui-1', 'ui_render', 101, tableTree, { ok: true }, 'finished', 'bot-session-1', 'turn-1')
    const botReply: ChatItem = {
      kind: 'message',
      id: 'm1',
      role: 'assistant',
      sessionId: 'bot-session-1',
      text: '这是公开卡片',
      createdAt: 102,
      turn: 'turn-1',
    }

    // Hidden internal exchange turn patches the card to v2
    const hiddenPatchTool = tool('patch-1', 'ui_patch', 201, patchTable, { ok: true, ui: tableSnapshotV2 }, 'finished', 'bot-session-1', 'turn-hidden')

    const allMessages = [renderTool, botReply, hiddenPatchTool]
    const hiddenTurns = new Set(['turn-hidden'])

    // Bot mode feeds visible messages to useSessionUiArtifacts
    const visibleMessages = allMessages.filter(item => !(item.turn !== undefined && hiddenTurns.has(item.turn)))
    expect(visibleMessages).toHaveLength(2)

    const visibleSections = chatSections(visibleMessages)
    const artifacts = projectUiArtifacts(visibleMessages, 'host-1', 'bot-session-1')
    expect(artifacts).toHaveLength(1)
    expect(artifacts[0]?.version).toBe(1) // Stays at v1! Hidden patch is never applied to visible card

    const placed = placeUiArtifacts(artifacts, visibleSections)
    const turn1Section = visibleSections.find(s => s.kind === 'process' && s.turn === 'turn-1')
    expect(turn1Section).toBeDefined()
    expect(placed.get(turn1Section!.key)?.cards[0]?.version).toBe(1)
    expect(placed.get(turn1Section!.key)?.pointers).toHaveLength(0)
  })

  it('routes UI action prompts via botMessageRequest in bot mode', () => {
    const fakeState = {
      bots: [{ id: 'bot-math', sessionId: 'session-math', name: '数学助手' }],
      rooms: [],
      btwCards: {},
      btwSupported: true,
      exchangeTurns: {},
      activity: {},
      questions: {},
      views: {},
      approvals: [],
      models: [],
    }

    // Normal bot action prompt
    const req = botMessageRequest(fakeState as any, 'bot-math', '选择选项 A')
    expect(req.endpoint).toBe('send')
    expect(req.payload).toEqual({
      sessionId: 'bot-math',
      text: '选择选项 A',
    })

    // /btw aside prompt
    const btwReq = botMessageRequest(fakeState as any, 'bot-math', '/btw 这是一个旁注提问')
    expect(btwReq.endpoint).toBe('btw')
    expect(btwReq.payload).toEqual({
      sessionId: 'bot-math',
      text: '这是一个旁注提问',
    })
  })
})
