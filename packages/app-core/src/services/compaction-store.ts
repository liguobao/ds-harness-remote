import type { StoredCompactionRecord } from './storage'

type CompactionState =
  | 'accepted'
  | 'running'
  | 'cancelling'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'interrupted'
  | 'unconfirmed'

interface CompactionRecord {
  sessionId: string
  requestId: string
  operationId?: string
  state: CompactionState
  updatedAt: number
}

type Scopes = Record<string, Record<string, CompactionRecord>>

const MAX_RECORDS = 32
const MAX_RECORDS_PER_SCOPE = 8

let writeQueue: Promise<void> = Promise.resolve()

/**
 * Load the SecureStore-backed module lazily. `storage.ts` pulls Expo native
 * modules that unit tests do not compose; persistence failures must only make
 * tracking unavailable, never break the connection or a compaction.
 */
async function persistence() {
  return await import('./storage')
}

function serialize<T>(work: (scopes: Scopes) => T): Promise<T> {
  const run = writeQueue.then(async () => {
    const { loadCompactionRecords, saveCompactionRecords } = await persistence()
    const scopes = await loadCompactionRecords() as unknown as Scopes
    const result = work(scopes)
    await saveCompactionRecords(scopes as unknown as Record<string, Record<string, StoredCompactionRecord>>)
    return result
  })
  writeQueue = run.then(() => undefined, () => undefined)
  return run
}

function prune(scopes: Scopes): void {
  for (const [scope, records] of Object.entries(scopes)) {
    const entries = Object.entries(records).sort((left, right) => right[1].updatedAt - left[1].updatedAt)
    for (const [sessionId] of entries.slice(MAX_RECORDS_PER_SCOPE)) delete records[sessionId]
    if (Object.keys(records).length === 0) delete scopes[scope]
  }
  const all = Object.values(scopes).flatMap(records => Object.values(records))
  if (all.length <= MAX_RECORDS) return
  const keep = new Set(all.sort((left, right) => right.updatedAt - left.updatedAt).slice(0, MAX_RECORDS))
  for (const [scope, records] of Object.entries(scopes)) {
    for (const [sessionId, record] of Object.entries(records)) {
      if (!keep.has(record)) delete records[sessionId]
    }
    if (Object.keys(records).length === 0) delete scopes[scope]
  }
}

/** Product-side store for Host-owned compaction attempts (scoped per Host). */
export const compactionStore = {
  async load(scope: string, sessionId: string): Promise<CompactionRecord | undefined> {
    const { loadCompactionRecords } = await persistence()
    const scopes = await loadCompactionRecords() as unknown as Scopes
    return scopes[scope]?.[sessionId]
  },
  async list(scope: string): Promise<CompactionRecord[]> {
    const { loadCompactionRecords } = await persistence()
    const scopes = await loadCompactionRecords() as unknown as Scopes
    return Object.values(scopes[scope] ?? {})
  },
  async save(scope: string, record: CompactionRecord): Promise<void> {
    await serialize(scopes => {
      const records = scopes[scope] ?? {}
      records[record.sessionId] = record
      scopes[scope] = records
      prune(scopes)
    })
  },
  async remove(scope: string, sessionId: string): Promise<void> {
    await serialize(scopes => {
      const records = scopes[scope]
      if (records === undefined) return
      delete records[sessionId]
      if (Object.keys(records).length === 0) delete scopes[scope]
    })
  },
}
