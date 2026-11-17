export function createNativeRpcId(): string {
  const g = globalThis.crypto
  if (g?.randomUUID !== undefined) return g.randomUUID()
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}
