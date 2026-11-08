import type { PairLink } from '../types'
import { strings as zhCN } from '../locales/i18n'

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '10.0.2.2', '::1', '[::1]'])

function stripIpv6Brackets(hostname: string): string {
  return hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname
}

function isPrivateIpv6(hostname: string): boolean {
  const host = stripIpv6Brackets(hostname).toLowerCase()
  if (!host.includes(':') || !/^[0-9a-f:]+$/.test(host)) return false
  if (host === '::1') return true
  // Unique Local Addresses (fc00::/7) and link-local (fe80::/10)
  return /^f[cd][0-9a-f]{2}:/.test(host) || /^fe[89ab][0-9a-f]:/.test(host)
}

/** Private-network IPv4/IPv6 ranges reachable only on loopback, LAN, link-local, or CGNAT/VPN. */
function isPrivateHostname(hostname: string): boolean {
  if (LOCAL_HOSTS.has(hostname)) return true
  if (isPrivateIpv6(hostname)) return true
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname)
  if (match === null) return false
  const octets = match.slice(1).map(Number)
  if (octets.some(value => value > 255)) return false
  const [a = 0, b = 0] = octets
  return (
    a === 10 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254) ||
    (a === 100 && b >= 64 && b <= 127)
  )
}

export function normalizeServerUrl(input: string): string {
  const value = input.trim().replace(/\/+$/, '')
  if (value.length === 0) throw new Error(zhCN.validation.serverRequired)

  const withScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(value) ? value : `https://${value}`
  let url: URL
  try {
    url = new URL(withScheme)
  } catch {
    throw new Error(zhCN.validation.serverInvalid)
  }

  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isPrivateHostname(url.hostname))) {
    throw new Error(zhCN.validation.httpsRequired)
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error(zhCN.validation.serverPartsForbidden)
  }
  return url.toString().replace(/\/$/, '')
}

export function websocketUrl(baseUrl: string): string {
  const url = new URL(normalizeServerUrl(baseUrl))
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  url.pathname = '/ws/v1/connect'
  return url.toString()
}

export function parsePairLink(url: string): PairLink {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'dshremote:' || parsed.hostname !== 'pair') return {}
    if (parsed.searchParams.get('v') !== '1') return {}
    const server = parsed.searchParams.get('server') ?? undefined
    return server === undefined ? {} : { server }
  } catch {
    return {}
  }
}
