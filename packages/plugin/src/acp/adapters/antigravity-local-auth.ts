import { execFileSync, spawn, type ChildProcessWithoutNullStreams, type SpawnOptions } from 'node:child_process'
import { tmpdir } from 'node:os'

/**
 * Antigravity's macOS build has no public file-only auth switch. Its composite
 * token store does, however, fall back to the local token file when the
 * process cannot access an OS keyring. Keep that fallback scoped to the agy
 * child process instead of changing the user's keychain or settings.
 */
export function spawnAntigravityWithLocalCredentials(
  binary: string,
  args: string[],
  options: SpawnOptions,
): ChildProcessWithoutNullStreams {
  if (process.platform !== 'darwin') {
    return spawn(binary, args, options) as ChildProcessWithoutNullStreams
  }

  const keychains = readKeychainSearchList()
  if (keychains.length === 0) {
    throw new Error('Unable to isolate the macOS Keychain for Antigravity.')
  }

  const emptyKeychain = `${tmpdir()}/dsh-antigravity-empty-keychain-${process.pid}-${Date.now()}`
  const restore = `/usr/bin/security list-keychains -s ${keychains.map(shellQuote).join(' ')} >/dev/null 2>&1 || true`
  const script = [
    'set +e',
    `restore() { ${restore}; }`,
    `/usr/bin/security list-keychains -s ${shellQuote(emptyKeychain)} >/dev/null 2>&1 || exit 125`,
    // Non-interactive shells redirect stdin for background jobs to /dev/null;
    // explicitly keep the ACP pipe attached to agy.
    '"$@" <&0 &',
    'agy_pid=$!',
    'on_signal() { kill -TERM "$agy_pid" 2>/dev/null || true; wait "$agy_pid" 2>/dev/null || true; restore; exit 143; }',
    'trap on_signal TERM INT HUP',
    'wait "$agy_pid"',
    'status=$?',
    'restore',
    'exit "$status"',
  ].join('\n')

  return spawn('/bin/sh', ['-c', script, 'dsh-antigravity-wrapper', binary, ...args], options) as ChildProcessWithoutNullStreams
}

function readKeychainSearchList(): string[] {
  try {
    const output = execFileSync('/usr/bin/security', ['list-keychains'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    return output
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.startsWith('"') && line.endsWith('"'))
      .map(line => line.slice(1, -1).replace(/\\"/g, '"'))
      .filter(Boolean)
  } catch {
    return []
  }
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}
