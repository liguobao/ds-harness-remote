import { mkdtemp, rm } from 'node:fs/promises'
import { hostname, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveConfig, type Config } from '../src/config.js'
import { CONTROL_RPC_PREFIX } from '../src/control-route.js'
import { PluginControlRuntime, type PluginSettingsBinding } from '../src/control-runtime.js'
import type { HostAuthorizationControl, HostConnectionHandle } from '../src/client-runtime.js'
import type { ControlResult } from '../src/control-result.js'
import {
  candidateBinaryPaths,
  installOrConfigureBackend,
  findExistingBinary,
  isBuiltinAcpBackend,
  BUILTIN_ACP_SPECS,
} from '../src/acp/backend-installer.js'

const directories: string[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(directories.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

describe('acp-backend-installer candidate paths & safety', () => {
  it('validates builtin backends whitelist', () => {
    expect(isBuiltinAcpBackend('hermes')).toBe(true)
    expect(isBuiltinAcpBackend('cursor')).toBe(true)
    expect(isBuiltinAcpBackend('claude')).toBe(true)
    expect(isBuiltinAcpBackend('codex')).toBe(true)
    expect(isBuiltinAcpBackend('pi')).toBe(true)
    expect(isBuiltinAcpBackend('opencode')).toBe(true)
    expect(isBuiltinAcpBackend('antigravity')).toBe(true)
    expect(isBuiltinAcpBackend('malicious-pkg')).toBe(false)
  })

  it('generates Windows candidate paths including drive letters and AppData', () => {
    const candidates = candidateBinaryPaths('hermes', {
      platform: 'win32',
      env: { LOCALAPPDATA: 'C:\\mock-env\\fixture-user\\AppData\\Local' },
      homedir: 'C:\\mock-env\\fixture-user',
    })
    expect(candidates).toContain('D:\\Hermes\\bin\\hermes.exe')
    expect(candidates).toContain('C:\\Hermes\\bin\\hermes.exe')
  })

  it('generates macOS candidate paths including Applications and home', () => {
    const candidates = candidateBinaryPaths('cursor', {
      platform: 'darwin',
      homedir: '/mock-env/fixture-user',
    })
    expect(candidates).toContain('/mock-env/fixture-user/.local/bin/agent')
    expect(candidates).toContain('/Applications/Cursor.app/Contents/MacOS/agent')
  })
})

describe('settings.acp.installOrConfigure endpoint & workflow', () => {
  it('case (a): scans existing binary and automatically writes back absolute path and enables backend', async () => {
    const directory = await temporaryDirectory()
    const initialConfig: Config = {
      acp: {
        enabled: false,
        backends: [{ id: 'hermes', enabled: false, command: 'hermes' }],
      },
    }
    const settings = settingsBinding(initialConfig)
    const setAgentBackendsMock = vi.fn(async () => undefined)
    const mockHost = { setAgentBackends: setAgentBackendsMock } as unknown as HostAuthorizationControl
    const runtime = new PluginControlRuntime(resolveConfig(settings.get()), directory, settings, undefined, mockHost)
    const handler = register(runtime)

    // Mock backend installer to simulate finding Hermes at D:\Hermes\bin\hermes.exe
    const mockOutcome = {
      action: 'configured' as const,
      detectedCommand: 'D:\\Hermes\\bin\\hermes.exe',
      downloadUrl: BUILTIN_ACP_SPECS.hermes.downloadUrl,
    }
    const installerModule = await import('../src/acp/backend-installer.js')
    const spy = vi.spyOn(installerModule, 'installOrConfigureBackend').mockResolvedValue(mockOutcome)

    const res = await handler('settings.acp.installOrConfigure', { backend: 'hermes' }, signal())
    expect(res.ok).toBe(true)
    if (!res.ok) return

    expect(res.value).toMatchObject({
      acpInstallResult: {
        backend: 'hermes',
        action: 'configured',
      },
    })

    // Check that settings.replace was called and configuration updated
    const saved = resolveConfig(settings.get())
    const savedHermes = saved.acp?.backends.find(b => b.id === 'hermes')
    expect(savedHermes?.enabled).toBe(true)
    expect(savedHermes?.command).toBe('D:\\Hermes\\bin\\hermes.exe')
    expect(saved.acp?.enabled).toBe(true)
    expect(setAgentBackendsMock).toHaveBeenCalledWith(expect.objectContaining({
      acp: expect.objectContaining({ enabled: true }),
    }))

    spy.mockRestore()
  })

  it('case (b): executes silent npm install for npm package backend and enables it', async () => {
    const directory = await temporaryDirectory()
    const initialConfig: Config = {
      acp: {
        enabled: false,
        backends: [{ id: 'claude', enabled: false, command: 'claude-agent-acp' }],
      },
    }
    const settings = settingsBinding(initialConfig)
    const runtime = new PluginControlRuntime(resolveConfig(settings.get()), directory, settings, undefined, undefined)
    const handler = register(runtime)

    const mockOutcome = {
      action: 'installed' as const,
      detectedCommand: 'D:\\npm-global\\claude-agent-acp.cmd',
      downloadUrl: BUILTIN_ACP_SPECS.claude.downloadUrl,
    }
    const installerModule = await import('../src/acp/backend-installer.js')
    const spy = vi.spyOn(installerModule, 'installOrConfigureBackend').mockResolvedValue(mockOutcome)

    const res = await handler('settings.acp.installOrConfigure', { backend: 'claude' }, signal())
    expect(res.ok).toBe(true)
    if (!res.ok) return

    expect(res.value).toMatchObject({
      acpInstallResult: {
        backend: 'claude',
        action: 'installed',
      },
    })

    const saved = resolveConfig(settings.get())
    const savedClaude = saved.acp?.backends.find(b => b.id === 'claude')
    expect(savedClaude?.enabled).toBe(true)
    expect(savedClaude?.command).toBe('D:\\npm-global\\claude-agent-acp.cmd')
    expect(saved.acp?.enabled).toBe(true)

    spy.mockRestore()
  })

  it('case (c): returns download guide for desktop software when binary is not found', async () => {
    const directory = await temporaryDirectory()
    const initialConfig: Config = {
      acp: {
        enabled: false,
        backends: [{ id: 'cursor', enabled: false, command: 'agent' }],
      },
    }
    const settings = settingsBinding(initialConfig)
    const runtime = new PluginControlRuntime(resolveConfig(settings.get()), directory, settings, undefined, undefined)
    const handler = register(runtime)

    const mockOutcome = {
      action: 'download_required' as const,
      downloadUrl: 'https://cursor.com',
    }
    const installerModule = await import('../src/acp/backend-installer.js')
    const spy = vi.spyOn(installerModule, 'installOrConfigureBackend').mockResolvedValue(mockOutcome)

    const res = await handler('settings.acp.installOrConfigure', { backend: 'cursor' }, signal())
    expect(res.ok).toBe(true)
    if (!res.ok) return

    expect(res.value).toMatchObject({
      acpInstallResult: {
        backend: 'cursor',
        action: 'download_required',
        downloadUrl: 'https://cursor.com',
      },
    })

    // Config should not be modified to enable broken binary
    const saved = resolveConfig(settings.get())
    const savedCursor = saved.acp?.backends.find(b => b.id === 'cursor')
    expect(savedCursor?.enabled).toBe(false)

    spy.mockRestore()
  })

  it('backend-installer directly tests silent installer runner execution with mock execFile', async () => {
    let installed = false
    const mockExec = vi.fn(async () => {
      installed = true
      return { stdout: 'added 1 package', stderr: '' }
    })
    const checkExecutableMock = vi.fn((path: string) => installed && path.includes('pi-acp'))
    const mockNpmCli = 'C:\\mock-env\\node_modules\\npm\\bin\\npm-cli.js'

    const outcome = await installOrConfigureBackend('pi', {
      platform: 'win32',
      npmPrefix: 'D:\\npm-global',
      npmCliPath: mockNpmCli,
      execFileImpl: mockExec,
      checkExecutable: checkExecutableMock,
    })

    expect(mockExec).toHaveBeenCalled()
    const call = mockExec.mock.calls[0] as unknown as [string, string[], { timeout: number }]
    expect(call[0]).toBe(process.execPath)
    expect(call[1]).toEqual([mockNpmCli, 'install', '-g', 'pi-acp', '--no-fund', '--no-audit'])
    expect(call[2].timeout).toBe(120_000)
    // Verify no shell executable is passed
    expect(call[0]).not.toMatch(/cmd(?:\\.exe)?$/i)
    expect(call[0]).not.toMatch(/powershell(?:\\.exe)?$/i)
    expect(call[0]).not.toMatch(/bash(?:\\.exe)?$/i)
    expect(outcome.action).toBe('installed')
    expect(outcome.detectedCommand).toContain('pi-acp')
  })

  it('backend-installer fails cleanly if installed binary cannot be located after npm install', async () => {
    const mockExec = vi.fn(async () => ({ stdout: 'added 1 package', stderr: '' }))
    const checkExecutableMock = vi.fn(() => false) // Never finds binary
    const mockNpmCli = 'C:\\mock-env\\node_modules\\npm\\bin\\npm-cli.js'

    await expect(installOrConfigureBackend('pi', {
      platform: 'win32',
      npmPrefix: 'D:\\npm-global',
      npmCliPath: mockNpmCli,
      execFileImpl: mockExec,
      checkExecutable: checkExecutableMock,
    })).rejects.toThrow(/Installation of Pi completed but executable could not be verified/)
  })

  it('rejects invalid or unauthorized backend names before invoking installer', async () => {
    const directory = await temporaryDirectory()
    const settings = settingsBinding({ acp: { enabled: true, backends: [] } })
    const runtime = new PluginControlRuntime(resolveConfig(settings.get()), directory, settings, undefined, undefined)
    const handler = register(runtime)

    const res = await handler('settings.acp.installOrConfigure', { backend: 'malicious-agent' }, signal())
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.error.message).toContain('A valid built-in ACP backend is required')
  })

  it('defaultCheckExecutable distinguishes regular files from directories', async () => {
    const { writeFile } = await import('node:fs/promises')
    const { defaultCheckExecutable } = await import('../src/acp/backend-installer.js')
    const tempDir = await temporaryDirectory()
    const testFile = join(tempDir, 'executable.cmd')
    await writeFile(testFile, 'echo test')

    expect(defaultCheckExecutable(testFile, 'win32')).toBe(true)
    expect(defaultCheckExecutable(tempDir, 'win32')).toBe(false)
  })

  it('candidateBinaryPaths skips npm directory scans for desktop-only backends', () => {
    const cursorCandidates = candidateBinaryPaths('cursor', {
      platform: 'win32',
      npmPrefix: 'D:\\should-not-be-scanned',
    })
    expect(cursorCandidates.some(c => c.includes('should-not-be-scanned'))).toBe(false)

    const piCandidates = candidateBinaryPaths('pi', {
      platform: 'win32',
      npmPrefix: 'D:\\should-be-scanned',
    })
    expect(piCandidates.some(c => c.includes('should-be-scanned'))).toBe(true)
  })
})

function register(runtime: PluginControlRuntime) {
  let handler: ((endpoint: string, payload: unknown, signal: AbortSignal) => Promise<ControlResult<unknown>>) | undefined
  let channel: string | undefined
  runtime.register({
    rpc: {
      handle: (registeredChannel, next) => {
        channel = registeredChannel
        handler = next
        return async () => undefined
      },
    },
  } satisfies HostConnectionHandle)
  expect(channel).toBe(CONTROL_RPC_PREFIX)
  if (handler === undefined) throw new Error('control handler was not registered')
  return handler
}

function settingsBinding(initial: Config): PluginSettingsBinding {
  let value = structuredClone(initial)
  return {
    get: () => structuredClone(value),
    replace: async section => { value = structuredClone(section) },
  }
}

function signal(): AbortSignal { return new AbortController().signal }

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-remote-test-acp-'))
  directories.push(directory)
  return directory
}
