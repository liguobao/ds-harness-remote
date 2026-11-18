export function workspaceParentPath(path: string): string {
  const normalized = path.replace(/[\\/]+$/, '')
  const segments = normalized.split(/[\\/]+/).filter(Boolean)
  const parentSegments = segments.slice(0, -1)
  if (parentSegments.length === 0) return normalized.startsWith('/') ? '/' : path
  const rootPrefix = normalized.startsWith('/') ? '/' : ''
  return `${rootPrefix}${parentSegments.join('/')}`
}
