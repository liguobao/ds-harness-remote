/**
 * End-to-end check of the F1 bucket reuse inside the real code path.
 *
 * `sameArtifacts` on its own is only a predicate. What matters is that
 * `placeUiArtifacts` output, run twice over an unchanged message list, is
 * collapsed back to the previous buckets so `ChatProcessGroup` keeps its props.
 *
 * The stabilizer lives inside the component, so this test mirrors its exact
 * loop over real `placeUiArtifacts` output rather than reaching into React.
 */
import { describe, expect, it } from 'vitest'

import { placeUiArtifacts, projectUiArtifacts } from '../src/state/ui-artifacts'
import { chatSections } from '../src/state/message-helpers'
import type { ChatItem, ChatMessage, ToolActivity } from '../src/types'

const HOST = 'host-1'
const SESSION = 'session-1'

function user(id: string): ChatMessage {
  return { kind: 'message', id, sessionId: SESSION, createdAt: 0, role: 'user', text: id }
}

function uiTool(id: string, turn: string, uiId: string): ToolActivity {
  return {
    kind: 'tool', id, sessionId: SESSION, createdAt: 0, turn,
    toolName: 'ui_render', toolKey: 'ui_render', state: 'finished',
    // safeTree requires { root, components } with root present among unique ids.
    arguments: JSON.stringify({ root: 'root', components: [{ id: 'root', type: 'view' }] }),
    uiResultMeta: { ok: true, policy: {} },
    nativeSeq: 1,
  } as ToolActivity
}

/** Mirror of the bucket stabilizer in chat-screen.tsx. */
function stabilize(
  next: ReadonlyMap<string, { cards: { uiId: string; version: number }[]; pointers: { uiId: string; version: number }[] }>,
  previous: ReadonlyMap<string, { cards: { uiId: string; version: number }[]; pointers: { uiId: string; version: number }[] }>,
): ReadonlyMap<string, { cards: { uiId: string; version: number }[]; pointers: { uiId: string; version: number }[] }> {
  if (previous.size === 0) return next
  let changed = next.size !== previous.size
  const stable = new Map<string, (typeof next extends ReadonlyMap<string, infer V> ? V : never)>()
  const same = (a: readonly { uiId: string; version: number }[], b: readonly { uiId: string; version: number }[]): boolean => {
    if (a === b) return true
    if (a.length !== b.length) return false
    for (let index = 0; index < a.length; index += 1) {
      const left = a[index]
      const right = b[index]
      if (left === right) continue
      if (left === undefined || right === undefined) return false
      if (left.uiId !== right.uiId || left.version !== right.version) return false
    }
    return true
  }
  for (const [key, bucket] of next) {
    const old = previous.get(key)
    if (old !== undefined && same(old.cards, bucket.cards) && same(old.pointers, bucket.pointers)) {
      stable.set(key, old)
    } else {
      stable.set(key, bucket)
      changed = true
    }
  }
  return changed ? stable : previous
}

describe('F1 bucket reuse over real projections', () => {
  it('keeps the artifact arrays when a later delta changes only text', () => {
    const items: ChatItem[] = [
      user('u1'),
      uiTool('tool-ui-1', 't1', 'tool-ui-1'),
      { kind: 'message', id: 'a1', sessionId: SESSION, createdAt: 0, turn: 't1', role: 'assistant', text: 'first', replyGroup: 't1' },
    ]

    const sections1 = chatSections(items)
    const artifacts1 = projectUiArtifacts(items, HOST, SESSION)
    const bySection1 = placeUiArtifacts(artifacts1, sections1)

    // A streaming delta: assistant text grows, nothing about the card changes.
    const streamed: ChatItem[] = items.map(item =>
      item.id === 'a1' && item.kind === 'message' ? { ...item, text: item.text + '!' } : item)
    const sections2 = chatSections(streamed, sections1)
    const artifacts2 = projectUiArtifacts(streamed, HOST, SESSION)
    const rawBySection2 = placeUiArtifacts(artifacts2, sections2)

    // Without stabilization the arrays are fresh objects...
    const keyWithCard = bySection1.size > 0 ? [...bySection1.keys()][0] : undefined
    expect(keyWithCard).toBeDefined()

    // ...and the stabilizer must hand the previous ones back.
    const stable2 = stabilize(rawBySection2, bySection1)
    const stableKey = keyWithCard as string
    expect(stable2.get(stableKey)).toBe(bySection1.get(stableKey))
    expect(stable2.get(stableKey)?.cards).toBe(bySection1.get(stableKey)?.cards)
  })

  it('replaces the bucket when the card version advances', () => {
    const base: ChatItem[] = [
      user('u1'),
      uiTool('tool-ui-1', 't1', 'tool-ui-1'),
    ]
    const sections1 = chatSections(base)
    const bySection1 = placeUiArtifacts(projectUiArtifacts(base, HOST, SESSION), sections1)
    const key = [...bySection1.keys()][0]
    if (key === undefined) throw new Error('expected a bucket')

    // Simulate a ui_patch bump for the same card.
    const patched = new Map(bySection1)
    const bucket = bySection1.get(key)
    if (bucket === undefined) throw new Error('expected a bucket')
    patched.set(key, {
      cards: bucket.cards.map(card => ({ ...card, version: card.version + 1 })),
      pointers: bucket.pointers,
    })

    const stable = stabilize(patched, bySection1)
    expect(stable.get(key)).not.toBe(bySection1.get(key))
  })
})
