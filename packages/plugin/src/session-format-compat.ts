export type SessionFormatCompatibility = 'legacy-to-v3'

export function normalizeLegacySessionGatewayValue(endpoint: string, value: unknown): unknown {
  if (endpoint === 'session/page') return normalizePage(value)
  if (endpoint === 'session/follow') return normalizeFollowFrame(value)
  return value
}

function normalizeFollowFrame(value: unknown): unknown {
  if (!isRecord(value)) return value
  if (value.type === 'snapshot') {
    return {
      ...value,
      header: normalizeHeader(value.header),
      records: normalizeRecords(value.records),
      ...(value.assistantStream === undefined ? { assistantStream: { revision: 0 } } : {}),
    }
  }
  return normalizeEntry(value)
}

function normalizePage(value: unknown): unknown {
  if (!isRecord(value)) return value
  return { ...value, records: normalizeRecords(value.records) }
}

function normalizeRecords(value: unknown): unknown {
  if (!Array.isArray(value)) return value
  return value.map(record => normalizeEntry(record))
}

function normalizeEntry(value: unknown): unknown {
  if (!isRecord(value) || value.type !== 'event') return value
  return { ...value, event: normalizeEvent(value.event) }
}

function normalizeHeader(value: unknown): unknown {
  if (!isRecord(value)) return value
  const next: Record<string, unknown> = {
    ...value,
    version: 3,
    ...(value.delegationDepth === undefined ? { delegationDepth: 0 } : {}),
  }
  return next.agentPreset === 'code' ? { ...next, agentPreset: 'ptc' } : next
}

function normalizeEvent(value: unknown): unknown {
  if (!isRecord(value)) return value
  let next: Record<string, unknown> = value
  const type = normalizeEventType(value.type)
  if (type !== value.type) next = { ...next, type }

  const data = normalizeEventData(type, next.data)
  if (data !== next.data) next = { ...next, data }

  const surfaceOp = normalizeSurfaceOp(next.surfaceOp)
  if (surfaceOp !== next.surfaceOp) next = { ...next, surfaceOp }

  return next
}

function normalizeEventType(value: unknown): unknown {
  if (value === 'tool/code-dispatch-start') return 'tool/ptc-dispatch-start'
  if (value === 'tool/code-dispatch') return 'tool/ptc-dispatch'
  return value
}

function normalizeEventData(type: unknown, value: unknown): unknown {
  if (!isRecord(value)) return value
  if (type === 'request/header') return normalizeRequestHeaderData(value)
  if (type === 'agent-preset/selected' && value.agentPreset === 'code') return { ...value, agentPreset: 'ptc' }
  if (type === 'user/message') return normalizeMessage(value)
  if (type === 'agent/inbox/spliced' && Array.isArray(value.inserted)) {
    return { ...value, inserted: value.inserted.map(item => normalizeMessage(item)) }
  }
  if (type === 'session/title-llm-request' && Array.isArray(value.messages)) {
    return { ...value, messages: value.messages.map(item => normalizeMessage(item)) }
  }
  return value
}

function normalizeRequestHeaderData(value: Record<string, unknown>): unknown {
  if (!isRecord(value.header)) return value
  const header = normalizeRequestHeader(value.header)
  return header === value.header ? value : { ...value, header }
}

function normalizeRequestHeader(value: Record<string, unknown>): Record<string, unknown> {
  let changed = false
  const next: Record<string, unknown> = {}
  for (const [key, field] of Object.entries(value)) {
    if (key === 'system') {
      changed = true
      continue
    }
    if (key === 'tools' && Array.isArray(field) && field.length === 0) {
      changed = true
      continue
    }
    if (key === 'adapterDefaults' && isRecord(field) && Object.keys(field).length === 0) {
      changed = true
      continue
    }
    next[key] = field
  }
  return changed ? next : value
}

function normalizeMessage(value: unknown): unknown {
  if (!isRecord(value) || !isRecord(value.source)) return value
  if (value.source.kind !== 'plugin' || value.source.plugin !== 'tools-code-mode') return value
  return { ...value, source: { ...value.source, plugin: 'tools-ptc' } }
}

function normalizeSurfaceOp(value: unknown): unknown {
  if (!isRecord(value) || value.op !== 'replace') return value
  const { start, end, ...rest } = value
  if (start === undefined && end === undefined) return value
  return {
    ...rest,
    op: 'replace',
    ...(start === undefined ? {} : { startSeq: start }),
    ...(end === undefined ? {} : { endSeq: end }),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
