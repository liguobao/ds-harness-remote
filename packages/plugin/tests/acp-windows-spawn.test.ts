import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, win32 } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runScenarios } from '../../../scripts/test-scenarios.mjs'
import {
  candidateBinaryPaths,
  defaultCheckExecutable,
  installOrConfigureBackend,
  lookupSystemPath,
} from '../src/acp/backend-installer.js'
import { AntigravityAcpClient } from '../src/acp/adapters/antigravity-process.js'
import { ClaudeAcpClient } from '../src/acp/adapters/claude-process.js'
import { CursorAcpClient } from '../src/acp/adapters/cursor-process.js'
import { HermesAcpClient } from '../src/acp/adapters/hermes-process.js'
import { KimiAcpClient } from '../src/acp/adapters/kimi-process.js'
import { opencodeHasNativeApi } from '../src/acp/adapters/opencode-native-api.js'
import { OpencodeAcpClient } from '../src/acp/adapters/opencode-process.js'
import { SafeLogger } from '../src/logging.js'
import {
  escapeCmdBatchArgument,
  execFileCommand,
  isWindowsExecutablePath,
  resolveNpmCmdShim,
  resolveSpawnTarget,
  selectWindowsExecutable,
  spawnCommand,
} from '../src/acp/windows-spawn.js'

const tempDirs: string[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-win-spawn-'))
  tempDirs.push(dir)
  return dir
}

describe('Windows ACP executable filtering and .cmd/.bat spawn safety', () => {
  it('filters extensionless POSIX shims on win32 and prioritizes .exe over .cmd/.bat/.com', async () => {
    const dir = await makeTempDir()
    const posixShim = join(dir, 'claude-agent-acp')
    const cmdShim = join(dir, 'claude-agent-acp.cmd')
    const batShim = join(dir, 'claude-agent-acp.bat')
    const exeBin = join(dir, 'claude-agent-acp.exe')
    await Promise.all([
      writeFile(posixShim, '#!/bin/sh\n'),
      writeFile(cmdShim, '@echo off\n'),
      writeFile(batShim, '@echo off\n'),
      writeFile(exeBin, 'MZ'),
    ])

    expect(isWindowsExecutablePath(posixShim)).toBe(false)
    expect(isWindowsExecutablePath(join(dir, 'script.ps1'))).toBe(false)
    expect(isWindowsExecutablePath(cmdShim)).toBe(true)
    expect(isWindowsExecutablePath(batShim)).toBe(true)
    expect(isWindowsExecutablePath(exeBin)).toBe(true)
    expect(isWindowsExecutablePath('C:\\Tools\\CLI.COM')).toBe(true)

    expect(defaultCheckExecutable(posixShim, 'win32')).toBe(false)
    expect(defaultCheckExecutable(cmdShim, 'win32')).toBe(true)

    // `where` returns the extensionless POSIX shim before `.cmd`; it must be skipped.
    const check = (candidate: string) => [posixShim, cmdShim, batShim, exeBin].some(
      existing => win32.resolve(existing).toLowerCase() === win32.resolve(candidate).toLowerCase(),
    )
    expect(selectWindowsExecutable([posixShim, cmdShim], check)).toBe(win32.resolve(cmdShim))
    expect(selectWindowsExecutable([posixShim, batShim, cmdShim], check)).toBe(win32.resolve(cmdShim))
    expect(selectWindowsExecutable([posixShim, cmdShim, exeBin], check)).toBe(win32.resolve(exeBin))
    expect(selectWindowsExecutable([posixShim], check)).toBeUndefined()

    const npmCandidates = candidateBinaryPaths('claude', { platform: 'win32', npmPrefix: 'D:\\npm-global' })
    expect(npmCandidates.indexOf('D:\\npm-global\\claude-agent-acp.exe')).toBeLessThan(
      npmCandidates.indexOf('D:\\npm-global\\claude-agent-acp.cmd'),
    )
  })

  it('resolves standard npm/pnpm .cmd shims directly to process.execPath without a shell', async () => {
    const dir = await makeTempDir()
    const entryDir = join(dir, 'node_modules', '@agentclientprotocol', 'claude-agent-acp', 'dist')
    await mkdir(entryDir, { recursive: true })
    const entryJs = join(entryDir, 'index.js')
    await writeFile(entryJs, 'console.log("ok")\n')

    const cmdShimV3 = [
      '@ECHO off',
      'GOTO start',
      ':find_dp0',
      'SET dp0=%~dp0',
      'EXIT /b',
      ':start',
      'SETLOCAL',
      'CALL :find_dp0',
      'IF EXIST "%dp0%\\node.exe" (',
      '  SET "_prog=%dp0%\\node.exe"',
      ') ELSE (',
      '  SET "_prog=node"',
      '  SET PATHEXT=%PATHEXT:;.JS;=;%',
      ')',
      'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@agentclientprotocol\\claude-agent-acp\\dist\\index.js" %*',
    ].join('\r\n')

    const cmdShimV2 = [
      '@IF EXIST "%~dp0\\node.exe" (',
      '  "%~dp0\\node.exe"  "%~dp0\\node_modules\\@agentclientprotocol\\claude-agent-acp\\dist\\index.js" %*',
      ') ELSE (',
      '  @SETLOCAL',
      '  @SET PATHEXT=%PATHEXT:;.JS;=;%',
      '  node  "%~dp0\\node_modules\\@agentclientprotocol\\claude-agent-acp\\dist\\index.js" %*',
      ')',
    ].join('\r\n')

    await runScenarios([
      {
        name: 'npm cmd-shim v3 resolves directly to node without Electron GUI mode',
        run: () => {
          const cmdPath = win32.join(dir, 'claude-agent-acp.cmd')
          const env: NodeJS.ProcessEnv = { PATH: 'C:\\Windows' }
          const resolved = resolveSpawnTarget(cmdPath, ['--help'], { env }, {
            platform: 'win32',
            readFileSync: () => cmdShimV3,
            isFile: candidate => win32.resolve(candidate) === win32.resolve(entryJs),
            nodeExecPath: 'C:\\Program Files\\DeepSeek\\DeepSeek.exe',
            isElectron: true,
          })
          expect(resolved.file).toBe('C:\\Program Files\\DeepSeek\\DeepSeek.exe')
          expect(resolved.args).toEqual([win32.resolve(entryJs), '--help'])
          expect(resolved.options.windowsHide).toBe(true)
          expect(resolved.options.windowsVerbatimArguments).toBeUndefined()
          expect(resolved.options.env?.ELECTRON_RUN_AS_NODE).toBe('1')
        },
      },
      {
        name: 'npm cmd-shim v2 resolves directly to process.execPath',
        run: () => {
          const cmdPath = win32.join(dir, 'claude-agent-acp.cmd')
          const resolved = resolveNpmCmdShim(cmdPath, {
            readFileSync: () => cmdShimV2,
            isFile: candidate => win32.resolve(candidate) === win32.resolve(entryJs),
            nodeExecPath: 'C:\\Program Files\\nodejs\\node.exe',
            isElectron: false,
          })
          expect(resolved).toEqual({
            file: 'C:\\Program Files\\nodejs\\node.exe',
            argsPrefix: [win32.resolve(entryJs)],
          })
        },
      },
      {
        name: 'custom batch scripts with extra SET variables fall back to cmd.exe',
        run: () => {
          const customCmd = `@echo off\r\nSET MY_TOKEN=secret\r\n"%~dp0\\node_modules\\@agentclientprotocol\\claude-agent-acp\\dist\\index.js" %*\r\n`
          expect(resolveNpmCmdShim(win32.join(dir, 'custom.cmd'), {
            readFileSync: () => customCmd,
            isFile: () => true,
          })).toBeUndefined()
        },
      },
    ])
  })

  it('falls back to cmd.exe /d /s /c with safe escaping and windowsHide: true, and rejects CR/LF/NUL', () => {
    const resolved = resolveSpawnTarget(
      'C:\\Program Files (x86)\\Cursor\\agent.cmd',
      ['acp', '--flag', 'hello & calc | dir > out %TEMP%'],
      {},
      {
        platform: 'win32',
        readFileSync: () => '@echo off\r\n"C:\\Cursor\\agent.exe" %*\r\n',
        isFile: () => false,
        comspec: 'C:\\Windows\\System32\\cmd.exe',
      },
    )

    expect(resolved.file).toBe('C:\\Windows\\System32\\cmd.exe')
    expect(resolved.args.slice(0, 3)).toEqual(['/d', '/s', '/c'])
    expect(resolved.options.windowsHide).toBe(true)
    expect(resolved.options.windowsVerbatimArguments).toBe(true)
    expect(resolved.args[3]).toContain('"C:\\Program Files (x86)\\Cursor\\agent.cmd"')
    expect(resolved.args[3]).toContain('^^&')
    expect(resolved.args[3]).toContain('^^|')
    expect(resolved.args[3]).toContain('^^>')
    expect(resolved.args[3]).toContain('^^%')

    for (const bad of ['arg\nwhoami', 'arg\rwhoami', 'arg\0whoami']) {
      expect(() => escapeCmdBatchArgument(bad)).toThrow(/CR, LF, or NUL/)
      expect(() => resolveSpawnTarget('C:\\Tools\\agent.cmd', [bad], {}, { platform: 'win32' })).toThrow(/CR, LF, or NUL/)
      expect(() => resolveSpawnTarget(bad, ['acp'], {}, { platform: 'win32' })).toThrow(/CR, LF, or NUL/)
    }
  })

  it('catches synchronous spawn exceptions across ACP process clients without crashing the caller', async () => {
    const syncEinval = Object.assign(new Error('spawn C:\\Users\\secret-user\\bin\\agent.cmd EINVAL'), { code: 'EINVAL' })
    const throwSpawn = () => {
      throw syncEinval
    }
    const warn = vi.fn()
    const logger = new SafeLogger({ debug: vi.fn(), info: vi.fn(), warn, error: vi.fn() }, 'debug')

    const clients = [
      { name: 'cursor', client: new CursorAcpClient('agent.cmd', logger, throwSpawn), code: 'CURSOR_BINARY_UNAVAILABLE' },
      { name: 'claude', client: new ClaudeAcpClient('claude-agent-acp.cmd', logger, throwSpawn), code: 'CLAUDE_BINARY_UNAVAILABLE' },
      { name: 'hermes', client: new HermesAcpClient('hermes.cmd', logger, throwSpawn), code: 'HERMES_BINARY_UNAVAILABLE' },
      { name: 'kimi', client: new KimiAcpClient('kimi.cmd', logger, throwSpawn), code: 'KIMI_BINARY_UNAVAILABLE' },
      { name: 'opencode', client: new OpencodeAcpClient('opencode.cmd', logger, throwSpawn), code: 'OPENCODE_BINARY_UNAVAILABLE' },
      { name: 'antigravity', client: new AntigravityAcpClient('agy.cmd', logger, throwSpawn, { sessionWorker: true }), code: 'ANTIGRAVITY_BINARY_UNAVAILABLE' },
    ] as const

    await runScenarios(clients.map(entry => ({
      name: entry.name,
      run: async () => {
        const unavailable = vi.fn()
        entry.client.onUnavailable(unavailable)
        try {
          await expect(entry.client.start()).rejects.toMatchObject({ code: entry.code })
          await expect(entry.client.start()).rejects.toMatchObject({ code: entry.code })
          expect(entry.client.isReady()).toBe(false)
          expect(unavailable).toHaveBeenCalledTimes(2)
          expect(unavailable).toHaveBeenNthCalledWith(1, entry.code)
          expect(unavailable).toHaveBeenNthCalledWith(2, entry.code)
          for (const [message] of warn.mock.calls) {
            expect(String(message)).not.toContain('secret-user')
          }
        } finally {
          await entry.client.close()
        }
      },
    })))
  })

  it('always passes windowsHide: true in installOrConfigureBackend and rejects unsafe args in opencodeHasNativeApi', async () => {
    let installed = false
    const mockExec = vi.fn(async () => {
      installed = true
      return { stdout: 'added 1 package', stderr: '' }
    })
    await installOrConfigureBackend('claude', {
      platform: 'win32',
      npmPrefix: 'D:\\npm-global',
      npmCliPath: 'C:\\node\\npm-cli.js',
      execFileImpl: mockExec,
      checkExecutable: path => installed && path.endsWith('claude-agent-acp.cmd'),
    })
    expect(mockExec).toHaveBeenCalledWith(
      process.execPath,
      ['C:\\node\\npm-cli.js', 'install', '-g', '@agentclientprotocol/claude-agent-acp', '--no-fund', '--no-audit'],
      expect.objectContaining({ windowsHide: true }),
    )

    await expect(
      opencodeHasNativeApi('opencode.cmd', ['acp', 'bad\narg'], undefined, new AbortController().signal),
    ).rejects.toMatchObject({ code: 'OPENCODE_CLI_PROBE_FAILED' })
  })

  if (process.platform === 'win32') {
    it('executes real Windows npm .cmd shims and custom .cmd fallback safely end-to-end', async () => {
      const dir = await makeTempDir()
      const pkgDir = join(dir, 'node_modules', 'fake-acp')
      await mkdir(pkgDir, { recursive: true })
      const entryJs = join(pkgDir, 'echo.js')
      await writeFile(entryJs, 'console.log(JSON.stringify(process.argv.slice(2)))')

      const npmShim = join(dir, 'fake-npm.cmd')
      await writeFile(npmShim, [
        '@ECHO off',
        'GOTO start',
        ':find_dp0',
        'SET dp0=%~dp0',
        'EXIT /b',
        ':start',
        'SETLOCAL',
        'CALL :find_dp0',
        'SET "_prog=node"',
        'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\fake-acp\\echo.js" %*',
      ].join('\r\n'))

      const npmRes = await execFileCommand(npmShim, ['--mode', 'a & b', '%TEMP%'], { encoding: 'utf8' })
      expect(JSON.parse(npmRes.stdout.trim())).toEqual(['--mode', 'a & b', '%TEMP%'])

      const fallbackCmd = join(dir, 'fallback.cmd')
      await writeFile(fallbackCmd, `@echo off\r\n"${process.execPath}" "${entryJs}" %*\r\n`)
      const trickyArgs = ['hello world', 'a & echo PWNED', 'c | d', '%TEMP%', 'e"f', 'C:\\dir\\', '^caret', '(paren)', '!PATH!', 'a>b', 'a<b']
      const fallbackRes = await execFileCommand(fallbackCmd, trickyArgs, { encoding: 'utf8' })
      expect(JSON.parse(fallbackRes.stdout.trim())).toEqual(trickyArgs)

      const child = spawnCommand(fallbackCmd, ['stream-ok'])
      const stdout = await new Promise<string>((resolve, reject) => {
        let data = ''
        child.stdout.on('data', chunk => { data += String(chunk) })
        child.on('error', reject)
        child.on('close', code => code === 0 ? resolve(data) : reject(new Error(`exit ${code}`)))
      })
      expect(JSON.parse(stdout.trim())).toEqual(['stream-ok'])

      const whereDir = await makeTempDir()
      const posixBin = join(whereDir, 'dsh-test-shim')
      const cmdBin = join(whereDir, 'dsh-test-shim.cmd')
      const exeBin = join(whereDir, 'dsh-test-shim.exe')
      await Promise.all([
        writeFile(posixBin, '#!/bin/sh\n'),
        writeFile(cmdBin, '@echo off\n'),
      ])
      const prevPath = process.env.PATH
      process.env.PATH = `${whereDir};${prevPath ?? ''}`
      try {
        expect(lookupSystemPath('dsh-test-shim', 'win32')).toBe(win32.resolve(cmdBin))
        await writeFile(exeBin, 'MZ')
        expect(lookupSystemPath('dsh-test-shim', 'win32')).toBe(win32.resolve(exeBin))
      } finally {
        process.env.PATH = prevPath
      }
    })
  }
})
