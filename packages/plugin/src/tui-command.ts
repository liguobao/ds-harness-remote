import type { Context } from '@deepseek-ai/cordis'
import type { ResolvedConfig } from './config.js'
import { renderCompactTerminalQr, renderTerminalQr } from './cli.js'
import { ServerApiError, type OAuthProvider, type OAuthQrSession } from './server-api.js'
import type { HostPluginRuntime } from './service.js'

const QR_POLL_INTERVAL_MS = 2_000
const REMOTE_LOGIN_SCENE_ID = 'remote-login'
const REMOTE_STATUS_SCENE_ID = 'remote-status'

type CommandResult = { kind: 'success'; text?: string } | { kind: 'error'; text: string }

interface CommandDefinitionLike {
  name: string
  description: string
  input?: { hint: string }
  recordInput?: boolean
  handler(invocation: { rawInput: string; signal: AbortSignal }): CommandResult | Promise<CommandResult>
}

interface CommandRuntimeLike {
  register(definition: CommandDefinitionLike): () => void
}

interface TuiPluginHostLike {
  registerCommand(pluginCtx: Context, definition: CommandDefinitionLike): () => void
}

interface CommandCompletionNodeLike {
  name: string
  description: string
  descriptions?: Readonly<Partial<Record<'zh' | 'en', string>>>
}

interface CommandTreeRuntimeLike {
  register(provider: {
    root: string
    descriptions?: Readonly<Partial<Record<'zh' | 'en', string>>>
    children(canonicalPath: readonly string[]): readonly CommandCompletionNodeLike[]
  }): () => void
}

interface ScenePropsLike {
  React: {
    createElement(type: unknown, props?: Record<string, unknown> | null, ...children: unknown[]): unknown
    useEffect(effect: () => void | (() => void), dependencies: readonly unknown[]): void
    useState<T>(initial: T): [T, (value: T) => void]
  }
  ui: {
    Box: unknown
    Text: unknown
    useInput(handler: (input: string, key: { escape?: boolean }) => void): void
    useTerminalSize(): { columns: number; rows: number }
  }
  close(): void
}

interface SceneRuntimeLike {
  register(descriptor: {
    id: string
    title?: string
    component(props: ScenePropsLike): unknown
  }, identity?: Context): () => void
  open(id: string): boolean
}

interface TuiContext extends Context {
  commands: CommandRuntimeLike
  tuiCommandTrees: CommandTreeRuntimeLike
  tuiScenes: SceneRuntimeLike
}

interface LoginSnapshot {
  phase: 'idle' | 'loading' | 'waiting' | 'complete' | 'expired' | 'error'
  provider: OAuthProvider
  qr?: string
  compactQr?: string
  scanUrl?: string
  account?: string
  error?: string
}

export interface TuiRemoteTarget {
  runtime: HostPluginRuntime
  config: ResolvedConfig
}

export interface TuiRemoteBinding {
  target?: TuiRemoteTarget
}

/** Soft TUI integration: Desktop profiles never wait for terminal-only services. */
export function installTuiRemoteCommand(
  ctx: Context,
  resolveTarget: () => TuiRemoteTarget | undefined,
): void {
  const tuiContext = ctx as TuiContext
  // The bundle's TUI-only Loader row exposes these services at the entry
  // boundary. A Desktop entry has neither and stays completely inert here.
  const commands = tuiContext.get('commands', false) as CommandRuntimeLike | undefined
  if (commands === undefined) return
  // Newer dsh-TUI versions attribute commands to their owning plugin through
  // this optional service. Older versions only expose the direct registry.
  const pluginHost = tuiContext.get('tuiPluginHost', false) as TuiPluginHostLike | undefined
  const trees = tuiContext.get('tuiCommandTrees', false) as CommandTreeRuntimeLike | undefined
  const scenes = tuiContext.get('tuiScenes', false) as SceneRuntimeLike | undefined
  const login = new RemoteLoginController(resolveTarget)
  const LoginScene = createRemoteLoginScene(login)
  const StatusScene = createRemoteStatusScene(resolveTarget)

  tuiContext.effect(() => {
    const definition: CommandDefinitionLike = {
      name: 'remote',
      description: 'Manage Remote Host login and connection status',
      input: { hint: '[status | login [github|zhihu] | logout]' },
      recordInput: false,
      handler: async ({ rawInput }) => {
        const args = rawInput.trim().split(/\s+/u).filter(Boolean)
        const command = args[0] ?? 'status'
        if (command === 'status' && args.length <= 1) {
          if (scenes?.open(REMOTE_STATUS_SCENE_ID) === true) return { kind: 'success' }
          return { kind: 'success', text: formatRemoteStatusInline(resolveTarget()) }
        }
        if (command === 'login' && args.length <= 2) {
          const provider = args[1] ?? 'zhihu'
          if (provider !== 'github' && provider !== 'zhihu') {
            return { kind: 'error', text: 'Usage: /remote login [github|zhihu]' }
          }
          if (scenes === undefined) {
            return {
              kind: 'error',
              text: `The Remote login screen is unavailable. Run "ds-harness-remote login ${provider}" outside dsh-TUI, then restart it.`,
            }
          }
          login.start(provider)
          if (!scenes.open(REMOTE_LOGIN_SCENE_ID)) {
            login.cancel()
            return { kind: 'error', text: 'The Remote login screen is unavailable.' }
          }
          return { kind: 'success' }
        }
        if (command === 'logout' && args.length === 1) {
          const target = resolveTarget()
          if (target === undefined) return remoteNotReady()
          try {
            await target.runtime.clearHostAuthorization()
            return {
              kind: 'success',
              text: 'Remote Host logged out and its local device identity was rotated.',
            }
          } catch (error) {
            return {
              kind: 'error',
              text: `Local Remote Host credentials were cleared, but Server revocation failed (${errorCode(error)}).`,
            }
          }
        }
        if (command === 'config') {
          return { kind: 'error', text: 'Host configuration is not supported yet.' }
        }
        return { kind: 'error', text: remoteCommandUsage() }
      },
    }
    const disposeCommand = registerRemoteCommand(tuiContext, commands, pluginHost, definition)
    const disposeTree = registerOptional(tuiContext, 'command completion', () => trees?.register({
        root: 'remote',
        descriptions: {
          en: 'Manage Remote Host login and connection status',
          zh: '管理 Remote Host 登录和连接状态',
        },
        children: remoteCommandChildren,
    }))
    const disposeScene = registerOptional(tuiContext, 'login scene', () => scenes?.register({
        id: REMOTE_LOGIN_SCENE_ID,
        title: 'Remote Host login',
        component: LoginScene,
    }, tuiContext))
    const disposeStatusScene = registerOptional(tuiContext, 'status scene', () => scenes?.register({
        id: REMOTE_STATUS_SCENE_ID,
        title: 'Remote Host status',
        component: StatusScene,
    }, tuiContext))

    return () => {
      login.cancel()
      disposeCommand()
      disposeTree()
      disposeScene()
      disposeStatusScene()
    }
  }, 'ds-harness-remote: dsh-tui /remote command')
}

function registerRemoteCommand(
  ctx: Context,
  commands: CommandRuntimeLike,
  pluginHost: TuiPluginHostLike | undefined,
  definition: CommandDefinitionLike,
): () => void {
  if (pluginHost === undefined) return commands.register(definition)
  try {
    return pluginHost.registerCommand(ctx, definition)
  } catch (error) {
    // dsh rc.2 with dsh-TUI 0.10.0-beta.4 mounts the mediated service but its
    // Cordis bundle loader does not admit third-party activations yet. Keep the
    // command usable on that exact compatibility seam; every other mediated
    // registration failure remains fail-closed.
    if (!hasErrorCode(error, 'COMPONENT_NOT_ADMITTED')) throw error
    ctx.logger.debug('dsh-TUI Remote command is using the legacy command registry because Component admission is unavailable')
    return commands.register(definition)
  }
}

function hasErrorCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error
    && (error as { code?: unknown }).code === code
}

function registerOptional(
  ctx: Context,
  feature: string,
  register: () => (() => void) | undefined,
): () => void {
  try {
    return register() ?? (() => {})
  } catch (error) {
    ctx.logger.warn(`dsh-TUI Remote ${feature} is unavailable`, { code: errorCode(error) })
    return () => {}
  }
}

function remoteCommandChildren(canonicalPath: readonly string[]): readonly CommandCompletionNodeLike[] {
  if (canonicalPath.length === 1 && canonicalPath[0] === 'remote') {
    return [
      {
        name: 'status',
        description: 'Show Remote Host authorization and connection status',
        descriptions: { zh: '查看 Remote Host 授权和连接状态' },
      },
      {
        name: 'login',
        description: 'Authorize this Host with a GitHub or Zhihu QR code',
        descriptions: { zh: '使用 GitHub 或知乎二维码授权当前 Host' },
      },
      {
        name: 'logout',
        description: 'Revoke this Host and rotate its local identity',
        descriptions: { zh: '撤销当前 Host 并轮换本地身份' },
      },
    ]
  }
  if (canonicalPath.length === 2 && canonicalPath[0] === 'remote' && canonicalPath[1] === 'login') {
    return [
      { name: 'zhihu', description: 'Sign in with Zhihu (default)', descriptions: { zh: '使用知乎登录（默认）' } },
      { name: 'github', description: 'Sign in with GitHub', descriptions: { zh: '使用 GitHub 登录' } },
    ]
  }
  return []
}

function remoteStatusLines(target: TuiRemoteTarget | undefined): readonly string[] {
  if (target === undefined) {
    return ['Remote Host is disabled or still starting. Check the ds-harness-remote settings and retry.']
  }
  const { runtime, config } = target
  const status = runtime.hostStatus()
  const diagnostics = runtime.diagnostics()
  const codex = runtime.codexStatus()
  const capabilities = new Set(diagnostics.capabilities)
  const connection = status.online
    ? 'online'
    : status.reconnecting
      ? 'reconnecting'
      : status.accountRequired
        ? 'authorization required'
        : 'offline'
  return [
    `Server: ${config.serverUrl ?? 'not configured'}`,
    'Host control: enabled',
    `Device: ${status.deviceId ?? 'not initialized'}`,
    `Authorization: ${status.authorized ? status.account === undefined ? 'logged in' : `logged in (${status.account})` : 'logged out'}`,
    `Server connection: ${connection}`,
    `Harness Remote API: ${capabilities.has('harness.api.v1')
      ? 'available (ApiProxy)'
      : capabilities.has('harness.remote.v3')
        ? 'available (Typert Remote Session V3)'
        : capabilities.has('harness.remote.v1')
          ? 'available (Typert Remote)'
        : 'unavailable'}`,
    `Remote clients: ${diagnostics.activeConnections}`,
    `Codex Remote: ${codex.enabled ? codex.state : 'disabled'}`,
    '',
    'Commands: /remote login [github|zhihu] · /remote status · /remote logout',
  ]
}

function formatRemoteStatusInline(target: TuiRemoteTarget | undefined): string {
  return remoteStatusLines(target).filter(Boolean).join(' · ')
}

function remoteCommandUsage(): string {
  return [
    'Usage:',
    '  /remote',
    '  /remote status',
    '  /remote login [github|zhihu]',
    '  /remote logout',
  ].join('\n')
}

function remoteNotReady(): CommandResult {
  return {
    kind: 'error',
    text: 'Remote Host is disabled or still starting. Check the ds-harness-remote settings and retry.',
  }
}

class RemoteLoginController {
  private current: LoginSnapshot = { phase: 'idle', provider: 'zhihu' }
  private readonly listeners = new Set<(snapshot: LoginSnapshot) => void>()
  private attempt = 0

  constructor(private readonly resolveTarget: () => TuiRemoteTarget | undefined) {}

  snapshot = (): LoginSnapshot => this.current

  subscribe = (listener: (snapshot: LoginSnapshot) => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  start(provider: OAuthProvider): void {
    const attempt = ++this.attempt
    this.update({ phase: 'loading', provider })
    void this.run(attempt, provider)
  }

  cancel(): void {
    this.attempt += 1
  }

  private async run(attempt: number, provider: OAuthProvider): Promise<void> {
    try {
      const target = this.resolveTarget()
      if (target === undefined) throw new Error('REMOTE_NOT_READY')
      const session = await target.runtime.startHostOAuthQrLogin(provider)
      const [qr, compactQr] = await Promise.all([
        renderTerminalQr(session.scanUrl),
        renderCompactTerminalQr(session.scanUrl),
      ])
      if (attempt !== this.attempt) return
      this.update({ phase: 'waiting', provider, qr, compactQr, scanUrl: session.scanUrl })
      await this.poll(attempt, provider, session, target.runtime)
    } catch (error) {
      if (attempt !== this.attempt) return
      this.update({ phase: 'error', provider, error: errorCode(error) })
    }
  }

  private async poll(
    attempt: number,
    provider: OAuthProvider,
    session: OAuthQrSession,
    runtime: HostPluginRuntime,
  ): Promise<void> {
    const deadline = Date.now() + session.expiresIn * 1_000
    while (attempt === this.attempt && Date.now() < deadline) {
      try {
        const result = await runtime.pollHostOAuthQrLogin(session.qrId)
        if (attempt !== this.attempt) return
        if (result.status === 'complete') {
          this.update({ phase: 'complete', provider, account: result.authorization.account })
          return
        }
        if (result.status === 'expired') break
      } catch (error) {
        if (!(error instanceof ServerApiError) || !error.retryable) throw error
      }
      await wait(Math.min(QR_POLL_INTERVAL_MS, Math.max(1, deadline - Date.now())))
    }
    if (attempt === this.attempt) this.update({ phase: 'expired', provider })
  }

  private update(snapshot: LoginSnapshot): void {
    this.current = snapshot
    for (const listener of this.listeners) listener(snapshot)
  }
}

function createRemoteLoginScene(controller: RemoteLoginController): (props: ScenePropsLike) => unknown {
  return function RemoteLoginScene({ React, ui, close }: ScenePropsLike): unknown {
    const [snapshot, setSnapshot] = React.useState(controller.snapshot())
    const terminal = ui.useTerminalSize()
    React.useEffect(() => {
      const unsubscribe = controller.subscribe(setSnapshot)
      return () => {
        unsubscribe()
        controller.cancel()
      }
    }, [])
    ui.useInput((input, key) => {
      if (key.escape === true || input.toLowerCase() === 'q') {
        controller.cancel()
        close()
      }
    })

    const provider = snapshot.provider === 'github' ? 'GitHub' : 'Zhihu'
    const other = snapshot.provider === 'github' ? '/remote login zhihu' : '/remote login github'
    const children: unknown[] = [
      React.createElement(ui.Text, { key: 'title', bold: true, color: 'accent' }, 'Remote Host login'),
      React.createElement(ui.Text, { key: 'provider' }, `Provider: ${provider} · You can also use ${other}`),
    ]

    if (snapshot.phase === 'loading') {
      children.push(React.createElement(ui.Text, { key: 'loading', color: 'subtle' }, 'Creating authorization QR code…'))
    } else if (snapshot.phase === 'waiting' && snapshot.qr !== undefined && snapshot.scanUrl !== undefined) {
      const fullRows = snapshot.qr.split('\n').length
      const fullColumns = printableWidth(snapshot.qr.split('\n')[0] ?? '')
      const useFullQr = terminal.rows >= fullRows + 7 && terminal.columns >= fullColumns + 4
      const qr = useFullQr || snapshot.compactQr === undefined ? snapshot.qr : snapshot.compactQr
      const qrRows = qr.split('\n').length
      const qrColumns = printableWidth(qr.split('\n')[0] ?? '')
      if (terminal.rows < qrRows + 7 || terminal.columns < qrColumns + 4) {
        children.push(React.createElement(
          ui.Text,
          { key: 'size-warning', color: 'warning' },
          `Resize the terminal to at least ${qrColumns + 4} × ${qrRows + 7} if the QR code is clipped.`,
        ))
      }
      children.push(
        React.createElement(ui.Text, { key: 'scan' }, 'Scan this QR code to authorize this Host:'),
        React.createElement(ui.Text, { key: 'qr', wrap: 'truncate' }, qr),
        React.createElement(ui.Text, { key: 'url', color: 'link', underline: true }, terminalLink(snapshot.scanUrl)),
        React.createElement(ui.Text, { key: 'waiting', color: 'subtle' }, 'Waiting for authorization…'),
      )
    } else if (snapshot.phase === 'complete') {
      children.push(React.createElement(
        ui.Text,
        { key: 'complete', color: 'success' },
        snapshot.account === undefined
          ? 'Remote Host login complete. The Host is reconnecting now.'
          : `Remote Host login complete for ${snapshot.account}. The Host is reconnecting now.`,
      ))
    } else if (snapshot.phase === 'expired') {
      children.push(React.createElement(ui.Text, { key: 'expired', color: 'warning' }, 'The QR code expired. Close this screen and run /remote login again.'))
    } else if (snapshot.phase === 'error') {
      children.push(React.createElement(ui.Text, { key: 'error', color: 'error' }, `Remote Host login failed (${snapshot.error ?? 'UNKNOWN'}).`))
    }

    children.push(React.createElement(ui.Text, { key: 'close', color: 'subtle' }, 'Press Esc or q to return.'))
    return React.createElement(ui.Box, {
      flexDirection: 'column',
      gap: 1,
      paddingX: Math.max(0, Math.min(2, Math.floor((terminal.columns - 1) / 2))),
    }, ...children)
  }
}

function createRemoteStatusScene(
  resolveTarget: () => TuiRemoteTarget | undefined,
): (props: ScenePropsLike) => unknown {
  return function RemoteStatusScene({ React, ui, close }: ScenePropsLike): unknown {
    const terminal = ui.useTerminalSize()
    ui.useInput((input, key) => {
      if (key.escape === true || input.toLowerCase() === 'q') close()
    })

    const children: unknown[] = [
      React.createElement(ui.Text, { key: 'title', bold: true, color: 'accent' }, 'Remote Host status'),
      ...remoteStatusLines(resolveTarget()).map((line, index) => React.createElement(
        ui.Text,
        { key: `status-${index}`, color: line === '' ? 'subtle' : undefined },
        line === '' ? ' ' : line,
      )),
      React.createElement(ui.Text, { key: 'close', color: 'subtle' }, 'Press Esc or q to return.'),
    ]
    return React.createElement(ui.Box, {
      flexDirection: 'column',
      gap: 1,
      paddingX: Math.max(0, Math.min(2, Math.floor((terminal.columns - 1) / 2))),
    }, ...children)
  }
}

function terminalLink(url: string): string {
  return `\u001B]8;;${url}\u0007${url}\u001B]8;;\u0007`
}

function printableWidth(value: string): number {
  return value.replace(/\u001B\[[0-9;]*m/gu, '').length
}

function errorCode(error: unknown): string {
  if (error instanceof ServerApiError) return error.code
  if (error instanceof Error && 'code' in error && typeof error.code === 'string') return error.code
  return 'CONNECTION_FAILED'
}

function wait(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}
