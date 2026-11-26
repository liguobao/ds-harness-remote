import { DuotoneIcons } from '../ui/duotone-icons'
import type { UiIconComponent } from '../ui/components'
import type { Messages } from '../locales/types'
import type { LoginMethod, RemoteDevice } from '../types'

const platformNames: Record<string, string> = {
  darwin: 'macOS',
  win32: 'Windows',
  linux: 'Linux',
  android: 'Android',
}

/** Human-readable OS name for a Host's `platform` field. */
export function platformName(platform: string): string {
  return platformNames[platform] ?? platform
}

/** Two-tone Duotone icon that matches the Host's operating system. */
export function platformIcon(platform: string): UiIconComponent {
  if (platform === 'win32') return DuotoneIcons.Monitor
  if (platform === 'linux') return DuotoneIcons.Server
  return DuotoneIcons.Laptop
}

/** Two-line list subtitle: OS plus the installed Harness version. */
export function deviceVersionSubtitle(device: RemoteDevice): string {
  return [
    platformName(device.platform),
    device.harnessVersion ? `Harness ${device.harnessVersion}` : undefined,
  ].filter(Boolean).join(' · ')
}

/** Host name shown beside an account or a web-console link. */
export function serverHostLabel(baseUrl?: string): string {
  if (!baseUrl) return ''
  try {
    return new URL(baseUrl).host
  } catch {
    return baseUrl.replace(/^https?:\/\//, '').replace(/\/+$/, '')
  }
}

/** Login method label shared by the remote-hosts account row and settings. */
export function loginMethodDisplayLabel(method: LoginMethod | undefined, s: Messages): string {
  if (method === 'oauth') return s.setup.oauth
  if (method === 'github-oauth') return s.setup.githubOAuth
  if (method === 'google-oauth') return 'Google'
  if (method === 'password') return s.setup.passwordMethod
  return s.common.unknown
}
