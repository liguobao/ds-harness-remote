/**
 * Project durable DSH tool events into the *latest successful* portable UI.
 * This is deliberately separate from ToolActivity text truncation and from
 * Remote's authenticated transport. Invalid, incomplete, failed and stale
 * updates never replace a previously rendered snapshot.
 */
import type { ChatItem, ToolActivity } from '../types'
import type { ChatSection } from './message-helpers'

export interface UiArtifact {
  kind: 'declarative' | 'widget' | 'composition'
  hostId: string
  sessionId: string
  uiId: string
  version: number
  turn?: string
  /** Turn that most recently patched the UI (the card stays in its original Turn). */
  updatedTurn?: string
  title?: string
  definition: Record<string, unknown>
  policy?: Record<string, unknown>
  originSeq: number
}

const UI_TOOLS = new Set(['ui_render', 'ui_patch', 'ui_render_widget', 'ui_compose'])
const MAX_UI_CHARS = 480_000
const BLOCK_ID = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/
const record = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x)
const nonempty = (x: unknown): x is string => typeof x === 'string' && x.length > 0
const version = (x: unknown): x is number => Number.isSafeInteger(x) && (x as number) >= 1

function splitComposeUiId(uiId: string): [string, string] | undefined {
  const at = uiId.indexOf('#')
  return at > 0 && at < uiId.length - 1 ? [uiId.slice(0, at), uiId.slice(at + 1)] : undefined
}

function safeComposition(x: Record<string, unknown>): boolean {
  if (!Array.isArray(x.blocks) || x.blocks.length === 0 || x.blocks.length > 24) return false
  const ids = new Set<string>()
  for (const block of x.blocks) {
    if (!record(block) || !nonempty(block.id) || !BLOCK_ID.test(block.id) || ids.has(block.id)) return false
    ids.add(block.id)
    if (block.type === 'markdown') {
      if (typeof block.text !== 'string' || block.text.trim().length === 0 || block.text.length > 60_000) return false
    } else if (block.type === 'catalog') {
      if (!safeTree(block as Record<string, unknown>)) return false
    } else if (block.type === 'widget') {
      if (!nonempty(block.html)) return false
    } else {
      return false
    }
  }
  return true
}

function safeArgs(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'string' || value.length > MAX_UI_CHARS) return undefined
  try { const x: unknown = JSON.parse(value); return record(x) ? x : undefined } catch { return undefined }
}

function safeTree(x: Record<string, unknown>): boolean {
  if (!nonempty(x.root) || !Array.isArray(x.components) || x.components.length > 2000) return false
  const ids = new Set<string>()
  for (const node of x.components) {
    if (!record(node) || !nonempty(node.id) || !nonempty(node.type) || ids.has(node.id)) return false
    ids.add(node.id)
  }
  return ids.has(x.root)
}

function safePolicy(x: unknown): Record<string, unknown> | undefined {
  if (!record(x)) return undefined
  // Do not accept arbitrary keys / out-of-range strings from Host metadata.
  const result: Record<string, unknown> = {}
  if (typeof x.allowNetwork === 'boolean') result.allowNetwork = x.allowNetwork
  if (typeof x.maxHeight === 'number' && x.maxHeight >= 100 && x.maxHeight <= 4000) result.maxHeight = x.maxHeight
  if (typeof x.sendPromptMaxChars === 'number' && x.sendPromptMaxChars > 0 && x.sendPromptMaxChars <= 4000) result.sendPromptMaxChars = x.sendPromptMaxChars
  for (const key of ['cdn', 'openLinkOrigins']) {
    if (Array.isArray(x[key]) && x[key].length <= 30 && x[key].every(y => typeof y === 'string' && y.length < 240)) {
      result[key] = x[key]
    }
  }
  return result
}

function toolSeq(tool: ToolActivity): number {
  return tool.nativeRevisionSeq ?? tool.nativeSeq ?? tool.nativeOrderSeq ?? tool.createdAt ?? 0
}

/** Read-only and deterministic: safe to recalculate after history paging or reconnect. */
export function projectUiArtifacts(items: readonly ChatItem[], hostId: string, sessionId: string): UiArtifact[] {
  if (!hostId || !sessionId) return []
  const latest = new Map<string, UiArtifact>()
  const blockVersions = new Map<string, number>()

  const isUiTool = (item: ChatItem): item is ToolActivity =>
    item.kind === 'tool'
    && item.sessionId === sessionId
    && item.state === 'finished'
    && UI_TOOLS.has(item.toolKey ?? '')
    && item.uiResultMeta !== undefined

  // Stably sort tools by authoritative event coordinate, preserving encounter order on collision.
  const tools = items
    .filter(isUiTool)
    .map((tool, idx) => ({ tool, idx }))
    .sort((a, b) => (toolSeq(a.tool) - toolSeq(b.tool)) || (a.idx - b.idx))
    .map(({ tool }) => tool)

  for (const tool of tools) {
    const meta = tool.uiResultMeta
    if (!record(meta) || meta.ok !== true) continue
    const args = safeArgs(tool.arguments)
    if (!args) continue
    const name = tool.toolKey
    const seq = toolSeq(tool)
    const policy = safePolicy(meta.policy)

    if (name === 'ui_render' && safeTree(args)) {
      const uiId = tool.id
      const existing = latest.get(uiId)
      if (existing) {
        // If an artifact was already recovered from a later patch (e.g. out of order
        // or later event seen first), do not regress its version/definition, but
        // anchor the turn and originSeq to the authoritative original ui_render!
        if (seq < existing.originSeq || existing.turn === undefined) {
          latest.set(uiId, {
            ...existing,
            turn: tool.turn ?? existing.turn,
            originSeq: Math.min(seq, existing.originSeq),
          })
        }
        continue
      }
      latest.set(uiId, {
        kind: 'declarative', hostId, sessionId, uiId, version: 1,
        definition: args, title: typeof args.title === 'string' ? args.title : undefined,
        turn: tool.turn, policy, originSeq: seq,
      })
    } else if (name === 'ui_compose' && safeComposition(args)) {
      const uiId = tool.id
      const existing = latest.get(uiId)
      if (existing) {
        if (seq < existing.originSeq || existing.turn === undefined) {
          latest.set(uiId, {
            ...existing,
            turn: tool.turn ?? existing.turn,
            originSeq: Math.min(seq, existing.originSeq),
          })
        }
        continue
      }
      latest.set(uiId, {
        kind: 'composition', hostId, sessionId, uiId, version: 1,
        definition: args, title: typeof args.title === 'string' ? args.title : undefined,
        turn: tool.turn, policy, originSeq: seq,
      })
      for (const block of (args.blocks as Record<string, unknown>[])) {
        if (block.type === 'catalog' && typeof block.id === 'string') {
          blockVersions.set(`${uiId}#${block.id}`, 1)
        }
      }
    } else if (name === 'ui_render_widget' && nonempty(args.html)) {
      const uiId = tool.id
      const existing = latest.get(uiId)
      if (existing) {
        if (seq < existing.originSeq || existing.turn === undefined) {
          latest.set(uiId, {
            ...existing,
            turn: tool.turn ?? existing.turn,
            originSeq: Math.min(seq, existing.originSeq),
          })
        }
        continue
      }
      latest.set(uiId, {
        kind: 'widget', hostId, sessionId, uiId, version: 1,
        definition: args, title: typeof args.title === 'string' ? args.title : undefined,
        turn: tool.turn, policy, originSeq: seq,
      })
    } else if (name === 'ui_patch' && nonempty(args.uiId) && version(args.baseVersion)) {
      const targetUiId = args.uiId
      const snapshot = meta.ui
      // Authoritative Host snapshot contract:
      // Host returns a full valid tree snapshot with snapshot.version === args.baseVersion + 1.
      if (!record(snapshot) || snapshot.uiId !== targetUiId
        || !version(snapshot.version)
        || snapshot.version !== args.baseVersion + 1
        || !safeTree(snapshot)) {
        continue
      }

      const parts = splitComposeUiId(targetUiId)
      if (parts) {
        const [compositionId, blockId] = parts
        const old = latest.get(compositionId)
        if (old !== undefined && old.kind === 'composition') {
          const currentBlockVersion = blockVersions.get(targetUiId) ?? 1
          if (snapshot.version <= currentBlockVersion || args.baseVersion < currentBlockVersion) {
            continue
          }
          const blocks = Array.isArray(old.definition.blocks) ? old.definition.blocks : []
          const blockIndex = blocks.findIndex(b => record(b) && b.type === 'catalog' && b.id === blockId)
          if (blockIndex === -1) continue

          const oldBlock = blocks[blockIndex] as Record<string, unknown>
          const updatedBlock = {
            ...oldBlock,
            ...(typeof snapshot.title === 'string' ? { title: snapshot.title } : {}),
            root: snapshot.root,
            components: snapshot.components,
          }
          const nextBlocks = [...blocks]
          nextBlocks[blockIndex] = updatedBlock
          blockVersions.set(targetUiId, snapshot.version)

          latest.set(compositionId, {
            ...old,
            version: old.version + 1,
            definition: {
              ...old.definition,
              blocks: nextBlocks,
            },
            title: typeof old.definition.title === 'string' ? old.definition.title : old.title,
            policy: policy ?? old.policy,
            turn: old.turn,
            updatedTurn: tool.turn ?? old.updatedTurn,
            originSeq: old.originSeq,
          })
        }
        continue
      }

      const old = latest.get(targetUiId)
      if (old !== undefined) {
        // Must match declarative kind
        if (old.kind !== 'declarative') continue

        // Stale or duplicate patch: an older baseVersion or older/equal snapshot version
        // must NEVER regress or overwrite the current state.
        if (snapshot.version <= old.version || args.baseVersion < old.version) {
          continue
        }

        // Advance to the verified snapshot.
        // If args.baseVersion === old.version, this is normal contiguous patching (v1 -> v2).
        // If args.baseVersion > old.version, an intermediate patch was omitted in history;
        // Host has authorized and executed the patch up to snapshot.version, so advance safely.
        latest.set(targetUiId, {
          ...old,
          version: snapshot.version,
          definition: snapshot,
          title: typeof snapshot.title === 'string' ? snapshot.title : old.title,
          policy: policy ?? old.policy,
          turn: old.turn,
          updatedTurn: tool.turn ?? old.updatedTurn,
          originSeq: old.originSeq,
        })
      } else {
        // History truncation / paging recovery:
        // Original ui_render (and any earlier patches) were paged out of the active window.
        // The Host's verified complete snapshot restores the artifact.
        latest.set(targetUiId, {
          kind: 'declarative',
          hostId,
          sessionId,
          uiId: targetUiId,
          version: snapshot.version,
          definition: snapshot,
          title: typeof snapshot.title === 'string' ? snapshot.title : undefined,
          turn: tool.turn,
          updatedTurn: tool.turn,
          policy,
          originSeq: seq,
        })
      }
    }
  }

  return [...latest.values()].sort((a, b) => a.originSeq - b.originSeq)
}

/** A split Turn must still have exactly one owner for each actionable card. */
export function placeUiArtifacts(artifacts: readonly UiArtifact[], sections: readonly ChatSection[]) {
  const byTurn = new Map<string, Extract<ChatSection, { kind: 'process' }>[]>()
  for (const section of sections) {
    if (section.kind !== 'process') continue
    const siblings = byTurn.get(section.turn) ?? []
    siblings.push(section)
    byTurn.set(section.turn, siblings)
  }
  const placed = new Map<string, { cards: UiArtifact[]; pointers: UiArtifact[] }>()
  const bucket = (key: string) => {
    let value = placed.get(key)
    if (!value) { value = { cards: [], pointers: [] }; placed.set(key, value) }
    return value
  }
  for (const ui of artifacts) {
    const candidates = ui.turn === undefined ? [] : byTurn.get(ui.turn) ?? []
    // Anchor to the actual creating tool; for paged recovery use the first
    // verified patch's coordinate. A later segment of the Turn gets no copy.
    const owner = candidates.find(section => section.items.some(item => item.kind === 'tool' && item.id === ui.uiId))
      ?? candidates.find(section => section.items.some(item => item.kind === 'tool' && toolSeq(item) === ui.originSeq))
      ?? candidates[0]
    if (owner) bucket(owner.key).cards.push(ui)
    if (ui.updatedTurn !== undefined && ui.updatedTurn !== ui.turn) {
      const update = byTurn.get(ui.updatedTurn)?.at(-1)
      if (update) bucket(update.key).pointers.push(ui)
    }
  }
  return placed
}
