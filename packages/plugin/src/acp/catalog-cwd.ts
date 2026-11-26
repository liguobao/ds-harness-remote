import { fileURLToPath } from 'node:url'

/**
 * Convert an upstream ACP `session/list` `cwd` (such as a `file://` URI or
 * Windows VS Code URI pathname `/d%3A/...`) into candidate OS filesystem paths.
 * Final path validation (`isAbsolute` + `realpath` + `stat.isDirectory`) remains
 * with `AcpRemoteGateway.requireExistingDirectory`.
 */
export function catalogCwdCandidates(rawCwd: string, platform: NodeJS.Platform = process.platform): string[] {
  if (typeof rawCwd !== 'string' || rawCwd.length === 0 || rawCwd.includes('\0')) return []

  if (/^file:\/\//i.test(rawCwd)) {
    return fileUriCandidates(rawCwd, platform)
  }

  if (platform !== 'win32') {
    return [rawCwd]
  }

  // Windows VS Code / Electron URI pathname with percent-encoded drive colon: `/d%3A/...`
  const encodedDrive = /^\/([A-Za-z])%3[Aa](?:\/(.*))?$/.exec(rawCwd)
  if (encodedDrive) {
    if (rawCwd.includes('\\')) return []
    const converted = buildWindowsDrivePath(encodedDrive[1]!, encodedDrive[2], true)
    return converted === undefined ? [] : [converted]
  }

  // Windows slash-prefixed drive pathname: `/D:/...` (with optional percent-encoded segments)
  const slashDrive = /^\/([A-Za-z]):(?:\/(.*))?$/.exec(rawCwd)
  if (slashDrive) {
    if (rawCwd.includes('\\')) return []
    const drive = slashDrive[1]!
    const rest = slashDrive[2]
    const candidates: string[] = []
    const literal = buildWindowsDrivePath(drive, rest, false)
    if (literal !== undefined) candidates.push(literal)
    if (rest !== undefined && rest.includes('%')) {
      const decoded = buildWindowsDrivePath(drive, rest, true)
      if (decoded !== undefined && decoded !== literal) candidates.push(decoded)
    }
    return candidates
  }

  return [rawCwd]
}

function fileUriCandidates(rawCwd: string, platform: NodeJS.Platform): string[] {
  let url: URL
  try {
    url = new URL(rawCwd)
  } catch {
    return []
  }
  if (url.protocol !== 'file:' || url.search !== '' || url.hash !== '') return []
  // Reject non-local hosts so Windows does not attempt SMB/NTLM lookups via realpath/stat.
  if (url.hostname !== '' && url.hostname.toLowerCase() !== 'localhost') return []
  try {
    const converted = fileURLToPath(url, { windows: platform === 'win32' })
    if (converted.includes('\0')) return []
    if (platform === 'win32' && /^[A-Za-z]:$/.test(converted)) {
      return [`${converted}\\`]
    }
    return [converted]
  } catch {
    return []
  }
}

function buildWindowsDrivePath(drive: string, rest: string | undefined, decodeSegments: boolean): string | undefined {
  if (rest === undefined || rest.length === 0) return `${drive}:\\`
  const segments = rest.split('/')
  const normalized: string[] = []
  for (const segment of segments) {
    if (segment.length === 0) continue
    let value = segment
    if (decodeSegments) {
      try {
        value = decodeURIComponent(segment)
      } catch {
        return undefined
      }
      if (value.includes('/') || value.includes('\\') || value.includes('\0')) return undefined
    }
    normalized.push(value)
  }
  return `${drive}:\\${normalized.join('\\')}`
}
