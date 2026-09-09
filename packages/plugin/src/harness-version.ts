import { readFile } from 'node:fs/promises'
import { dirname, isAbsolute, join } from 'node:path'

const LEGACY_PLACEHOLDER_VERSION = '0.0.1'

export type HarnessSessionGeneration = 'legacy' | 'v3'

export function normalizeHarnessVersion(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const version = value.trim()
  if (version.length === 0 || version.length > 64 || /[\u0000-\u001f]/u.test(version)) return undefined
  return version
}

export function selectHarnessVersion(
  reportedVersion: string | undefined,
  distributionVersion: string | undefined,
): string | undefined {
  if (reportedVersion !== undefined && reportedVersion !== LEGACY_PLACEHOLDER_VERSION) return reportedVersion
  return distributionVersion
}

/**
 * Select the Typert Session wire generation used by supported DSH builds.
 * Unknown builds stay on the established v0.1.2 profile; package peer ranges
 * prevent them from being presented as supported installations.
 */
export function harnessSessionGeneration(version: string | undefined): HarnessSessionGeneration {
  if (version === undefined) return 'legacy'
  const match = /^(?:dsh-)?v?(\d+)\.(\d+)\.(\d+)(?:-|$)/u.exec(version.trim())
  if (match === null) return 'legacy'
  const major = Number(match[1])
  const minor = Number(match[2])
  const patch = Number(match[3])
  return major === 0 && minor === 1 && patch >= 5 ? 'v3' : 'legacy'
}

/**
 * Compatibility fallback for Harness builds whose host.describe still returns
 * the historical 0.0.1 placeholder. The running CLI entrypoint sits below the
 * @deepseek-ai/dsh package root, so walk only its ancestor chain.
 */
export async function readHarnessDistributionVersion(
  entrypoint: string | undefined = process.argv[1],
): Promise<string | undefined> {
  if (entrypoint === undefined || !isAbsolute(entrypoint)) return undefined
  let directory = dirname(entrypoint)
  for (let depth = 0; depth < 8; depth += 1) {
    try {
      const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8')) as Record<string, unknown>
      if (manifest.name === '@deepseek-ai/dsh') return normalizeHarnessVersion(manifest.version)
    } catch {
      // Most ancestors do not contain a package manifest.
    }
    const parent = dirname(directory)
    if (parent === directory) break
    directory = parent
  }
  return undefined
}
