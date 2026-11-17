import type { PermissionSelect, RemoteSession } from '../types'

/** Old hosts embed options; new hosts publish only the current selection. Never infer a grant. */
export function sessionPermissions(session: RemoteSession): PermissionSelect | undefined {
  const value = session.projections?.values?.permissions
  if (typeof value !== 'object' || value === null) return undefined
  const source = value as { currentValue?: unknown; options?: unknown }
  if (typeof source.currentValue !== 'string') return undefined
  const options = (Array.isArray(source.options) ? source.options : []).flatMap(option => {
    if (typeof option !== 'object' || option === null) return []
    const item = option as { value?: unknown; name?: unknown; description?: unknown }
    if (typeof item.value !== 'string' || typeof item.name !== 'string') return []
    return [{ value: item.value, name: item.name, ...(typeof item.description === 'string' ? { description: item.description } : {}) }]
  })
  return { currentValue: source.currentValue, options }
}
