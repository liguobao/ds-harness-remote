const PREFIX = '.dsh-remote-message-file/'
const attachmentIdPattern = /^sha256:[a-f0-9]{64}$/

export interface MessageFileAttachment {
  attachmentId: string
  name: string
  bytes: number
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : undefined
}

export function messageFileAttachment(block: unknown): MessageFileAttachment | undefined {
  const value = record(block)
  const ref = value?.type === 'file' ? record(value.attachment) : undefined
  if (typeof ref?.attachmentId !== 'string' || !attachmentIdPattern.test(ref.attachmentId)
    || typeof ref.name !== 'string' || ref.name.length === 0 || ref.name.length > 255
    || ref.name === '.' || ref.name === '..' || /[\\/\x00-\x1f]/u.test(ref.name)
    || typeof ref.bytes !== 'number' || !Number.isSafeInteger(ref.bytes) || ref.bytes < 0) return
  return { attachmentId: ref.attachmentId, name: ref.name, bytes: ref.bytes }
}

export function messageFilePath(ref: MessageFileAttachment): string {
  return `${PREFIX}${ref.attachmentId}/${ref.name}`
}

export function isMessageFilePath(path: unknown): path is string {
  return typeof path === 'string' && path.startsWith(PREFIX)
}

/** One authenticated connection's index of attachments delivered by the Host's session journal. */
export class MessageFileAttachments {
  private readonly references = new Map<string, MessageFileAttachment>()

  observe(sessionId: string, value: unknown): void {
    const frame = record(value)
    const entries: unknown[] = Array.isArray(frame?.records) ? frame.records : [value]
    for (const entry of entries) {
      const event = record(record(entry)?.event)
      const data = record(event?.data)
      if (event?.type !== 'user/message' || data?.role !== 'user' || !Array.isArray(data.content)) continue
      for (const block of data.content) {
        const ref = messageFileAttachment(block)
        if (ref === undefined) continue
        const key = this.key(sessionId, messageFilePath(ref))
        this.references.delete(key)
        this.references.set(key, ref)
        if (this.references.size > 4096) this.references.delete(this.references.keys().next().value!)
      }
    }
  }

  get(sessionId: string, path: string): MessageFileAttachment | undefined {
    return this.references.get(this.key(sessionId, path))
  }

  clear(): void {
    this.references.clear()
  }

  private key(sessionId: string, path: string): string {
    return JSON.stringify([sessionId, path])
  }
}
