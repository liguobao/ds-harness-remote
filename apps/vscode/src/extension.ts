import os from 'node:os'
import { generateKeyPair, identityFingerprint } from '@dsh-remote/crypto'
import MarkdownIt from 'markdown-it'
import QRCode from 'qrcode'
import WebSocket from 'ws'
import * as vscode from 'vscode'
import { RemoteConnection } from './remote.js'
import { ServerApi } from './server-api.js'
import type { ChatMessage, Credentials, DeviceIdentity, PendingApproval, RemoteHost, RemoteSession, RemoteWorkspace, SessionModels } from './types.js'

const IDENTITY_KEY = 'dshRemote.identity.v1'
const CREDENTIALS_KEY = 'dshRemote.credentials.v1'
const TRUST_KEY = 'dshRemote.trustedHosts.v1'
const markdown = new MarkdownIt({ html: false, linkify: true, breaks: true })

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  if (globalThis.WebSocket === undefined) Object.assign(globalThis, { WebSocket })
  const controller = new Controller(context)
  const loginView = new LoginViewProvider(controller)
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('dshRemote.hosts', controller.explorerView),
    vscode.window.registerWebviewViewProvider('dshRemote.login', loginView),
    command('dshRemote.signIn', () => controller.signIn()),
    command('dshRemote.signOut', () => controller.signOut()),
    command('dshRemote.settings', () => controller.showSettings()),
    command('dshRemote.openSettings', () => controller.openSettings()),
    command('dshRemote.refresh', () => controller.refresh()),
    command('dshRemote.connect', (item?: HostItem) => controller.connect(item?.host)),
    command('dshRemote.disconnect', () => controller.disconnect()),
    command('dshRemote.addWorkspace', (item?: HostItem) => controller.addWorkspace(item?.host)),
    command('dshRemote.newSession', (item?: WorkspaceItem) => controller.newSession(item?.workspace)),
    command('dshRemote.openSession', (item?: SessionItem) => controller.openSession(item?.session)),
    { dispose: () => void controller.disconnect() },
  )
  await controller.restore()
}

export function deactivate(): void {}

function command(id: string, run: (...args: any[]) => Promise<void>): vscode.Disposable {
  return vscode.commands.registerCommand(id, (...args) => run(...args).catch(error => void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error))))
}

export class Controller {
  readonly explorerView = new RemoteExplorerProvider(element => this.treeChildren(element))
  private identity?: DeviceIdentity
  private credentials?: Credentials
  private hosts: RemoteHost[] = []
  private sessions: RemoteSession[] = []
  private workspaces: RemoteWorkspace[] = []
  private sessionPanel?: SessionPanel
  private signInTask?: Promise<void>
  private refreshTask?: Promise<Credentials | undefined>
  private authEpoch = 0

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly connection: RemoteConnection = new RemoteConnection(),
  ) {
    const timer = setInterval(() => {
      if (this.credentials !== undefined) void this.refresh().catch(() => undefined)
    }, 15_000)
    const unsubscribeClose = this.connection.onClose(() => {
      void this.clearConnectionState().catch(error => {
        void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error))
      })
    })
    context.subscriptions.push(
      { dispose: () => clearInterval(timer) },
      { dispose: unsubscribeClose },
    )
  }

  async restore(): Promise<void> {
    this.identity = await this.loadIdentity()
    const raw = await this.context.secrets.get(CREDENTIALS_KEY)
    if (raw) this.credentials = JSON.parse(raw) as Credentials
    await vscode.commands.executeCommand('setContext', 'dshRemote.signedIn', this.credentials !== undefined)
    if (this.credentials) await this.refresh().catch(() => undefined)
  }

  async signIn(): Promise<void> {
    const serverUrl = vscode.workspace.getConfiguration('dshRemote').get<string>('serverUrl', '').trim()
    if (!serverUrl) {
      await this.openSettings()
      void vscode.window.showInformationMessage('Set the DS Harness Remote server URL, then sign in.')
      return
    }
    const method = await vscode.window.showQuickPick([
      { label: '$(account) Scan QR code', description: 'Sign in with Zhihu', value: 'qr' as const },
      { label: '$(mail) Account and password', description: 'Sign in with email', value: 'password' as const },
    ], { title: 'Sign in to DS Harness Remote' })
    if (!method) return
    const api = new ServerApi(serverUrl)
    const login = method.value === 'qr' ? await this.signInWithQr(api) : await this.signInWithPassword(api)
    if (!login) return
    await this.completeSignIn(api, login)
  }

  async signInWithCredentials(serverUrl: string, email: string, password: string): Promise<void> {
    const api = new ServerApi(serverUrl)
    const login = await api.login(email, password)
    await this.completeSignIn(api, login)
  }

  async startInlineQr(serverUrl: string): Promise<{ api: ServerApi; qrId: string; scanUrl: string }> {
    const api = new ServerApi(serverUrl)
    const session = await api.startQrLogin()
    return { api, qrId: session.qrId, scanUrl: session.scanUrl }
  }

  async pollInlineQr(api: ServerApi, qrId: string): Promise<'pending' | 'expired' | 'complete'> {
    const result = await api.pollQrLogin(qrId)
    if (result.status !== 'complete') return result.status
    await this.completeSignIn(api, result)
    return 'complete'
  }

  configuredServerUrl(): string {
    return vscode.workspace.getConfiguration('dshRemote').get<string>('serverUrl', '')
  }

  private async completeSignIn(api: ServerApi, login: { token: string; account: string }): Promise<void> {
    if (this.signInTask !== undefined) return this.signInTask
    const task = this.runCompleteSignIn(api, login)
    this.signInTask = task
    try {
      await task
    } finally {
      if (this.signInTask === task) this.signInTask = undefined
    }
  }

  private async runCompleteSignIn(api: ServerApi, login: { token: string; account: string }): Promise<void> {
    const authEpoch = ++this.authEpoch
    const identity = this.identity ?? await this.loadIdentity()
    this.identity = identity
    const credentials = await api.authorizeClient(identity, login.token, login.account)
    if (authEpoch !== this.authEpoch) {
      await new ServerApi(credentials.serverUrl, credentials.accessToken).removeSelf().catch(() => undefined)
      return
    }
    this.credentials = credentials
    await this.context.secrets.store(CREDENTIALS_KEY, JSON.stringify(credentials))
    if (authEpoch !== this.authEpoch) return
    await vscode.workspace.getConfiguration('dshRemote').update('serverUrl', api.baseUrl, vscode.ConfigurationTarget.Global)
    if (authEpoch !== this.authEpoch) return
    await vscode.commands.executeCommand('setContext', 'dshRemote.signedIn', true)
    if (authEpoch !== this.authEpoch) return
    await this.refresh()
    if (authEpoch !== this.authEpoch) return
    void vscode.window.showInformationMessage(`Signed in as ${login.account}.`)
  }

  private async signInWithPassword(api: ServerApi): Promise<{ token: string; account: string } | undefined> {
    const email = await vscode.window.showInputBox({ title: 'Account and password', prompt: 'Account email', ignoreFocusOut: true })
    if (!email) return
    const password = await vscode.window.showInputBox({ title: 'Account and password', prompt: 'Password', password: true, ignoreFocusOut: true })
    if (!password) return
    return vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Signing in to DS Harness Remote…' }, () => api.login(email, password))
  }

  private async signInWithQr(api: ServerApi): Promise<{ token: string; account: string } | undefined> {
    const session = await api.startQrLogin()
    const svg = await QRCode.toString(session.scanUrl, { type: 'svg', width: 220, margin: 1, errorCorrectionLevel: 'L' })
    const panel = vscode.window.createWebviewPanel('dshRemote.qrLogin', 'Scan to sign in', vscode.ViewColumn.Active, { enableScripts: false })
    panel.webview.html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><style>body{display:grid;place-items:center;text-align:center;padding:32px;color:var(--vscode-foreground);background:var(--vscode-editor-background);font-family:var(--vscode-font-family)}.qr{padding:14px;background:white;border-radius:10px}.qr svg{display:block}p{color:var(--vscode-descriptionForeground)}</style></head><body><main><h2>Scan with Zhihu</h2><div class="qr">${svg}</div><p>Complete authorization on your phone. This page will close automatically.</p></main></body></html>`
    return new Promise((resolve, reject) => {
      let settled = false
      let polling = false
      const finish = (value?: { token: string; account: string }, error?: unknown): void => {
        if (settled) return
        settled = true
        clearInterval(timer)
        panel.dispose()
        error === undefined ? resolve(value) : reject(error)
      }
      const poll = async (): Promise<void> => {
        if (settled || polling) return
        polling = true
        try {
          const result = await api.pollQrLogin(session.qrId)
          if (result.status === 'complete') finish({ token: result.token, account: result.account })
          else if (result.status === 'expired') finish(undefined, new Error('The QR code expired. Please try again.'))
        } catch (error) { finish(undefined, error) } finally { polling = false }
      }
      const timer = setInterval(() => void poll(), 1_500)
      panel.onDidDispose(() => finish())
      void poll()
    })
  }

  async signOut(): Promise<void> {
    const credentials = this.credentials
    const signInTask = this.signInTask
    const refreshTask = this.refreshTask
    this.authEpoch += 1
    this.credentials = undefined
    await this.disconnect().catch(() => undefined)
    await signInTask?.catch(() => undefined)
    const refreshed = await refreshTask?.catch(() => undefined)
    if (refreshed !== undefined) {
      await new ServerApi(refreshed.serverUrl, refreshed.accessToken).removeSelf().catch(() => undefined)
    } else if (credentials !== undefined) {
      await this.revokeDevice(credentials).catch(() => undefined)
    }
    this.identity = undefined; this.hosts = []; this.sessions = []; this.workspaces = []
    await this.context.secrets.delete(CREDENTIALS_KEY)
    await this.context.secrets.delete(IDENTITY_KEY)
    await vscode.commands.executeCommand('setContext', 'dshRemote.signedIn', false)
    this.fireViews()
  }

  async showSettings(): Promise<void> {
    if (this.credentials === undefined) {
      await this.openSettings()
      return
    }
    const actions = [
      { label: '$(gear) Open Settings', description: 'Configure the server and connection', action: 'settings' as const },
      { label: '$(sign-out) Sign Out', description: this.credentials.account, action: 'signOut' as const },
    ]
    const picked = await vscode.window.showQuickPick(actions, { title: 'DS Harness Remote' })
    if (picked?.action === 'settings') await this.openSettings()
    if (picked?.action === 'signOut') {
      const confirmed = await vscode.window.showWarningMessage(`Sign out ${this.credentials?.account ?? ''}?`, { modal: true }, 'Sign Out')
      if (confirmed === 'Sign Out') await this.signOut()
    }
  }

  async openSettings(): Promise<void> {
    await vscode.commands.executeCommand('workbench.action.openSettings', '@ext:deepseek-harness-remote.deepseek-harness-remote-vscode')
  }

  async refresh(): Promise<void> {
    if (this.refreshTask !== undefined) { await this.refreshTask; return }
    const task = this.runRefresh()
    this.refreshTask = task
    try {
      await task
    } finally {
      if (this.refreshTask === task) this.refreshTask = undefined
    }
  }

  private async runRefresh(): Promise<Credentials | undefined> {
    const authEpoch = this.authEpoch
    let refreshed: Credentials | undefined
    let credentials = this.credentials
    if (!credentials) { this.fireViews(); return undefined }
    if (credentials.accessTokenExpiresAt <= Date.now() + 30_000) {
      credentials = await new ServerApi(credentials.serverUrl).refresh(credentials.deviceId, credentials.refreshToken, credentials.account)
      refreshed = credentials
      if (authEpoch !== this.authEpoch) return refreshed
      this.credentials = credentials
      await this.context.secrets.store(CREDENTIALS_KEY, JSON.stringify(credentials))
      if (authEpoch !== this.authEpoch) return refreshed
    }
    const hosts = await vscode.window.withProgress({ location: { viewId: 'dshRemote.hosts' } }, () => new ServerApi(credentials.serverUrl, credentials.accessToken).hosts())
    if (authEpoch !== this.authEpoch) return refreshed
    this.hosts = hosts
    if (this.connection.connectedHost) await this.loadHostContent()
    if (authEpoch !== this.authEpoch) return refreshed
    this.fireViews()
    return refreshed
  }

  async connect(host?: RemoteHost): Promise<void> {
    if (!this.credentials || !this.identity) throw new Error('Sign in first.')
    if (!host) {
      const picked = await vscode.window.showQuickPick(this.hosts.map(item => ({ label: item.name, description: item.online ? 'online' : 'offline', host: item })), { title: 'Connect to Host' })
      host = picked?.host
    }
    if (!host) return
    const trusted = this.context.globalState.get<Record<string, string>>(TRUST_KEY, {})
    if (trusted[host.deviceId] !== host.identityKey) {
      const fingerprint = identityFingerprint(host.identityKey).match(/.{1,4}/g)?.join(' ') ?? identityFingerprint(host.identityKey)
      const choice = await vscode.window.showWarningMessage(`Trust “${host.name}”? Verify its identity fingerprint: ${fingerprint}`, { modal: true }, 'Trust and Connect')
      if (choice !== 'Trust and Connect') return
      await this.context.globalState.update(TRUST_KEY, { ...trusted, [host.deviceId]: host.identityKey })
    }
    if (this.connection.connectedHost) await this.disconnect()
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Connecting to ${host.name}…` }, () => this.connection.connect(this.credentials!.serverUrl, this.identity!, host!, this.credentials!.accessToken, vscode.workspace.getConfiguration('dshRemote').get('forceRelay', false)))
    await this.loadHostContent()
    await vscode.commands.executeCommand('setContext', 'dshRemote.connected', true)
    this.fireViews()
  }

  async disconnect(): Promise<void> {
    try {
      await this.connection.close()
    } finally {
      await this.clearConnectionState()
    }
  }

  async newSession(workspace?: RemoteWorkspace): Promise<void> {
    if (!this.connection.connectedHost) throw new Error('Connect to a host first.')
    const cwd = workspace?.path ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
    const created = await this.connection.createSession(workspace ? { workspaceId: workspace.workspaceId } : { cwd })
    await this.loadHostContent(); this.fireViews()
    const session = this.sessions.find(item => item.sessionId === created.sessionId)
    await this.openSession(session ?? { sessionId: created.sessionId, updatedAt: Date.now(), running: false, blank: true, cwd })
  }

  async addWorkspace(host?: RemoteHost): Promise<void> {
    if (host && this.connection.connectedHost?.deviceId !== host.deviceId) await this.connect(host)
    if (!this.connection.connectedHost) throw new Error('Connect to a host first.')
    let path: string | undefined
    while (true) {
      const directory = await this.connection.listDirectory(path)
      const choice = await vscode.window.showQuickPick([
        { label: '$(check) Use this folder', description: directory.path, action: 'select' as const, path: directory.path },
        ...directory.crumbs.slice(0, -1).reverse().slice(0, 1).map(item => ({ label: '$(arrow-up) Parent folder', description: item.path, action: 'browse' as const, path: item.path })),
        ...directory.entries.map(item => ({ label: `$(folder) ${item.name}`, description: item.path, action: 'browse' as const, path: item.path })),
      ], { title: 'Add remote workspace', placeHolder: directory.truncated ? 'Choose a folder (list truncated by Host)' : 'Choose a folder' })
      if (!choice) return
      if (choice.action === 'browse') { path = choice.path; continue }
      await this.connection.createWorkspace(choice.path)
      await this.loadHostContent()
      this.fireViews()
      return
    }
  }

  async openSession(session?: RemoteSession): Promise<void> {
    if (!session) return
    if (this.sessionPanel === undefined) {
      const panel = new SessionPanel(session, this.connection, () => this.loadHostContent().then(() => this.fireViews()))
      this.sessionPanel = panel
      panel.onDispose(() => {
        if (this.sessionPanel === panel) this.sessionPanel = undefined
      })
    }
    await this.sessionPanel.open(session)
  }

  private async treeChildren(element?: RemoteTreeItem): Promise<RemoteTreeItem[]> {
    if (!element) return this.hosts.map(host => new HostItem(host, this.connection.connectedHost?.deviceId === host.deviceId))
    if (element instanceof HostItem) {
      if (this.connection.connectedHost?.deviceId !== element.host.deviceId) await this.connect(element.host)
      return this.workspaces.map(workspace => new WorkspaceItem(workspace))
    }
    if (element instanceof WorkspaceItem) {
      const ids = new Set(element.workspace.sessionIds)
      return this.sessions.filter(session => ids.has(session.sessionId)).sort((a, b) => b.updatedAt - a.updatedAt).map(session => new SessionItem(session))
    }
    return []
  }

  private async loadHostContent(): Promise<void> {
    [this.workspaces, this.sessions] = await Promise.all([this.connection.workspaces(), this.connection.sessions()])
  }

  private async clearConnectionState(): Promise<void> {
    this.sessions = []
    this.workspaces = []
    const panel = this.sessionPanel
    this.sessionPanel = undefined
    panel?.dispose()
    try {
      await vscode.commands.executeCommand('setContext', 'dshRemote.connected', false)
    } finally {
      this.fireViews()
    }
  }

  private async loadIdentity(): Promise<DeviceIdentity> {
    const stored = await this.context.secrets.get(IDENTITY_KEY)
    if (stored) return JSON.parse(stored) as DeviceIdentity
    const keys = generateKeyPair()
    const identity: DeviceIdentity = { deviceId: crypto.randomUUID(), name: `VS Code on ${os.hostname()}`, platform: 'vscode', ...keys }
    await this.context.secrets.store(IDENTITY_KEY, JSON.stringify(identity))
    return identity
  }

  private async revokeDevice(credentials: Credentials): Promise<void> {
    let accessToken = credentials.accessToken
    if (credentials.accessTokenExpiresAt <= Date.now() + 30_000) {
      const refreshed = await new ServerApi(credentials.serverUrl).refresh(credentials.deviceId, credentials.refreshToken, credentials.account)
      accessToken = refreshed.accessToken
    }
    await new ServerApi(credentials.serverUrl, accessToken).removeSelf()
  }
  private fireViews(): void { this.explorerView.fire() }
}

class LoginViewProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView
  private qrRun = 0
  private busy = false
  private error?: string
  private qrSvg?: string
  private activeTab: 'qr' | 'password' = 'qr'

  constructor(private readonly controller: Controller) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view
    view.webview.options = { enableScripts: true }
    view.webview.onDidReceiveMessage(message => {
      if (!isRecord(message)) return
      if (message.type === 'password' && typeof message.serverUrl === 'string' && typeof message.email === 'string' && typeof message.password === 'string') {
        void this.passwordLogin(message.serverUrl, message.email, message.password)
      }
      if (message.type === 'qr' && typeof message.serverUrl === 'string') void this.qrLogin(message.serverUrl)
      if (message.type === 'settings') void this.controller.openSettings()
      if (message.type === 'github') void vscode.env.openExternal(vscode.Uri.parse('https://github.com/liguobao/ds-harness-remote'))
      if (message.type === 'npm') void vscode.env.openExternal(vscode.Uri.parse('https://www.npmjs.com/package/ds-harness-remote'))
      if (message.type === 'tab' && (message.value === 'qr' || message.value === 'password')) this.activeTab = message.value
    })
    view.onDidDispose(() => { this.qrRun += 1; this.view = undefined })
    this.render()
    const serverUrl = this.controller.configuredServerUrl().trim()
    if (serverUrl.length > 0) void this.qrLogin(serverUrl)
  }

  private async passwordLogin(serverUrl: string, email: string, password: string): Promise<void> {
    if (this.busy) return
    this.activeTab = 'password'
    this.busy = true; this.error = undefined; this.render()
    try {
      await this.controller.signInWithCredentials(serverUrl, email, password)
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error)
    } finally {
      this.busy = false; this.render()
    }
  }

  private async qrLogin(serverUrl: string): Promise<void> {
    if (this.busy) return
    this.activeTab = 'qr'
    const run = ++this.qrRun
    this.busy = true; this.error = undefined; this.qrSvg = undefined; this.render()
    try {
      const session = await this.controller.startInlineQr(serverUrl)
      if (run !== this.qrRun) return
      this.qrSvg = await QRCode.toString(session.scanUrl, { type: 'svg', width: 188, margin: 1, errorCorrectionLevel: 'L' })
      this.busy = false; this.render()
      while (run === this.qrRun) {
        await new Promise(resolve => setTimeout(resolve, 1_500))
        if (run !== this.qrRun) return
        const status = await this.controller.pollInlineQr(session.api, session.qrId)
        if (status === 'complete') return
        if (status === 'expired') throw new Error('The QR code expired. Generate a new one.')
      }
    } catch (error) {
      if (run === this.qrRun) this.error = error instanceof Error ? error.message : String(error)
    } finally {
      if (run === this.qrRun) { this.busy = false; this.render() }
    }
  }

  private render(): void {
    const webview = this.view?.webview
    if (webview === undefined) return
    const nonce = crypto.randomUUID().replaceAll('-', '')
    const serverUrl = escapeHtml(this.controller.configuredServerUrl())
    const passwordTab = this.activeTab === 'password'
    const copy = loginCopy()
    const status = this.error === undefined ? '' : `<div class="error" role="alert">${escapeHtml(this.error)}</div>`
    const qr = this.qrSvg === undefined
      ? `<button id="qrButton" type="button" ${this.busy ? 'disabled' : ''}>${escapeHtml(this.busy ? copy.generating : copy.generateQr)}</button>`
      : `<div class="qr">${this.qrSvg}</div><p class="hint">${escapeHtml(copy.scanHint)}</p><button id="qrButton" class="secondary" type="button">${escapeHtml(copy.regenerateQr)}</button>`
    webview.html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'"><style>
      *{box-sizing:border-box}body{margin:0;padding:14px;color:var(--vscode-foreground);background:var(--vscode-sideBar-background);font-family:var(--vscode-font-family);font-size:13px}.intro{margin-bottom:16px}.intro strong{display:block;margin-bottom:5px;font-size:14px}.intro p{margin:0 0 7px;color:var(--vscode-descriptionForeground);font-size:11px;line-height:1.5}.link{height:auto;padding:0;color:var(--vscode-foreground);background:transparent;font-size:11px}.link:hover{color:var(--vscode-foreground);background:transparent;text-decoration:underline}.field{display:flex;flex-direction:column;gap:5px;margin-bottom:12px}label{font-size:11px;color:var(--vscode-descriptionForeground)}input{width:100%;height:30px;padding:4px 7px;color:var(--vscode-input-foreground);background:var(--vscode-input-background);border:1px solid var(--vscode-input-border);outline:none}input:focus{border-color:var(--vscode-foreground)}.urlRow{display:flex;gap:5px}.urlRow input{flex:1;min-width:0}.icon{width:30px;padding:0;background:transparent;color:var(--vscode-foreground);border:0}.tabs{display:flex;border-bottom:1px solid var(--vscode-panel-border);margin:16px 0 14px}.tab{flex:1;padding:8px 4px;color:var(--vscode-descriptionForeground);background:transparent;border:0;border-bottom:2px solid transparent}.tab.active{color:var(--vscode-foreground);border-bottom-color:var(--vscode-foreground)}.panel[hidden]{display:none}button{height:30px;padding:0 12px;color:var(--vscode-editor-background);background:var(--vscode-foreground);border:0;cursor:pointer}button:hover{opacity:.82}button:disabled{opacity:.55;cursor:default}.primary{width:100%}.secondary{width:100%;color:var(--vscode-foreground);background:transparent;border:1px solid var(--vscode-panel-border)}.qr{width:204px;max-width:100%;margin:0 auto 10px;padding:8px;background:#fff}.qr svg{display:block;width:100%;height:auto}.hint{text-align:center;color:var(--vscode-descriptionForeground);font-size:11px;line-height:1.45}.passwordHint{margin:8px 0 0}.error{margin:10px 0;padding:8px;color:var(--vscode-errorForeground);background:var(--vscode-inputValidation-errorBackground);border:1px solid var(--vscode-inputValidation-errorBorder)}
    </style></head><body><div class="intro"><strong>DS Harness Remote</strong><p>${escapeHtml(copy.overview)}</p><p>${escapeHtml(copy.requirementBefore)} <code>ds-harness-remote</code> ${escapeHtml(copy.requirementAfter)}</p><button class="link" id="npm" type="button">npm: ds-harness-remote ↗</button><br><button class="link" id="github" type="button">GitHub: deepseek-harness-remote ↗</button></div><div class="field"><label for="serverUrl">Server URL</label><div class="urlRow"><input id="serverUrl" type="url" value="${serverUrl}" placeholder="https://remote.example.com"><button class="icon" id="settings" type="button" title="${escapeHtml(copy.openSettings)}">⚙</button></div></div><div class="tabs" role="tablist"><button class="tab${passwordTab ? '' : ' active'}" id="qrTab" type="button">${escapeHtml(copy.qrLogin)}</button><button class="tab${passwordTab ? ' active' : ''}" id="passwordTab" type="button">${escapeHtml(copy.passwordLogin)}</button></div><section class="panel" id="qrPanel"${passwordTab ? ' hidden' : ''}>${qr}</section><section class="panel" id="passwordPanel"${passwordTab ? '' : ' hidden'}><form id="passwordForm"><div class="field"><label for="email">${escapeHtml(copy.email)}</label><input id="email" type="email" autocomplete="username" required></div><div class="field"><label for="password">${escapeHtml(copy.password)}</label><input id="password" type="password" autocomplete="current-password" required></div><button class="primary" type="submit" ${this.busy ? 'disabled' : ''}>${escapeHtml(this.busy ? copy.signingIn : copy.signIn)}</button><p class="hint passwordHint">${escapeHtml(copy.passwordHint)}</p></form></section>${status}<script nonce="${nonce}">const vscode=acquireVsCodeApi();const qrTab=document.getElementById('qrTab');const passwordTab=document.getElementById('passwordTab');const qrPanel=document.getElementById('qrPanel');const passwordPanel=document.getElementById('passwordPanel');function tab(password){qrTab.classList.toggle('active',!password);passwordTab.classList.toggle('active',password);qrPanel.hidden=password;passwordPanel.hidden=!password;vscode.postMessage({type:'tab',value:password?'password':'qr'});}qrTab.addEventListener('click',()=>tab(false));passwordTab.addEventListener('click',()=>tab(true));document.getElementById('npm').addEventListener('click',()=>vscode.postMessage({type:'npm'}));document.getElementById('github').addEventListener('click',()=>vscode.postMessage({type:'github'}));document.getElementById('settings').addEventListener('click',()=>vscode.postMessage({type:'settings'}));document.getElementById('qrButton')?.addEventListener('click',()=>vscode.postMessage({type:'qr',serverUrl:document.getElementById('serverUrl').value}));document.getElementById('passwordForm').addEventListener('submit',event=>{event.preventDefault();vscode.postMessage({type:'password',serverUrl:document.getElementById('serverUrl').value,email:document.getElementById('email').value,password:document.getElementById('password').value});});</script></body></html>`
  }
}

class SessionPanel {
  private readonly panel: vscode.WebviewPanel
  private readonly disposed = new vscode.EventEmitter<void>()
  private busy = false
  private running: boolean
  private cancelling = false
  private approvals: PendingApproval[] = []
  private readonly unsubscribeFrames: () => void
  private loaded = false
  private modelLabel = 'Model'
  private modelCatalog?: SessionModels
  private projectionValues: Record<string, unknown>
  private closed = false

  constructor(
    private session: RemoteSession,
    private readonly connection: RemoteConnection,
    private readonly onChanged: () => Promise<void>,
  ) {
    this.running = session.running
    this.projectionValues = { ...session.projections?.values }
    this.panel = vscode.window.createWebviewPanel(
      'dshRemote.session',
      sessionTitle(session),
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: false },
      { enableScripts: true, retainContextWhenHidden: true },
    )
    this.unsubscribeFrames = connection.onFrame(frame => {
      const payload = frame.payload
      if (payload.sessionId !== this.session.sessionId) return
      if (payload.type === 'session/event' && isRecord(payload.event)) {
        if (payload.event.type === 'turn/start') {
          this.running = true
          this.cancelling = false
          void this.show()
        } else if (payload.event.type === 'turn/end') {
          this.running = false
          this.cancelling = false
          void this.show()
        }
      } else if (payload.type === 'session/projection' && typeof payload.key === 'string') {
        this.projectionValues = { ...this.projectionValues, [payload.key]: payload.value }
        void this.show()
      } else if (payload.type === 'approval/requested' && typeof payload.approvalId === 'string') {
        this.approvals.push({ frameRpcId: frame.rpcId, sessionId: this.session.sessionId, approvalId: payload.approvalId, toolName: typeof payload.toolName === 'string' ? payload.toolName : 'Harness tool', ...(typeof payload.reason === 'string' ? { reason: payload.reason } : {}) })
        void this.show()
      } else if (payload.type === 'approval/resolved' && typeof payload.approvalId === 'string') {
        this.approvals = this.approvals.filter(item => item.approvalId !== payload.approvalId)
        void this.show()
      }
    })
    this.panel.onDidDispose(() => {
      this.closed = true
      this.unsubscribeFrames()
      this.disposed.fire()
      this.disposed.dispose()
    })
    this.panel.webview.onDidReceiveMessage(message => {
      if (!isRecord(message)) return
      if (message.type === 'send' && typeof message.text === 'string') void this.send(message.text)
      if (message.type === 'stop') void this.stop()
      if (message.type === 'refresh') void this.show()
      if (message.type === 'modelSelect' && typeof message.provider === 'string' && typeof message.model === 'string') void this.selectModel(message.provider, message.model, typeof message.reasoningEffort === 'string' ? message.reasoningEffort : undefined)
      if (message.type === 'permissionSelect' && typeof message.preset === 'string') void this.selectPermission(message.preset)
      if (message.type === 'approval' && typeof message.id === 'string' && (message.outcome === 'allowed-once' || message.outcome === 'rejected')) void this.answerApproval(message.id, message.outcome)
    })
  }

  onDispose(handler: () => void): void { this.disposed.event(handler) }

  dispose(): void { this.panel.dispose() }

  async open(session: RemoteSession): Promise<void> {
    if (session.sessionId !== this.session.sessionId) {
      this.session = session
      this.approvals = []
      this.projectionValues = { ...session.projections?.values }
      this.modelCatalog = undefined
      this.modelLabel = 'Model'
      this.loaded = false
      this.running = session.running
      this.cancelling = false
      this.panel.title = sessionTitle(session)
    } else {
      this.session = session
      this.projectionValues = { ...this.projectionValues, ...session.projections?.values }
    }
    await this.show()
  }

  async show(): Promise<void> {
    const session = this.session
    if (this.closed) return
    this.panel.reveal(vscode.ViewColumn.Beside, false)
    if (!this.loaded) this.panel.webview.html = renderLoadingSession(this.panel.webview, session)
    let messages: ChatMessage[]
    let catalog: SessionModels | undefined
    try {
      [messages, catalog] = await Promise.all([
        this.connection.history(session.sessionId),
        this.connection.models(session.sessionId).catch(() => undefined),
      ])
    } catch (error) {
      if (this.closed) return
      throw error
    }
    if (this.closed || session.sessionId !== this.session.sessionId) return
    if (catalog) {
      this.modelCatalog = catalog
      const selected = catalog.groups.flatMap(group => group.models).find(model => model.id === catalog.current.model)
      this.modelLabel = selected?.name ?? catalog.current.model
    }
    this.loaded = true
    this.panel.webview.html = renderSession(this.panel.webview, session, messages, this.approvals, this.busy, this.running, this.cancelling, this.modelLabel, this.modelCatalog, this.projectionValues)
  }

  private async send(value: string): Promise<void> {
    const text = value.trim()
    if (!text || this.busy) return
    this.busy = true
    void this.show()
    try {
      await this.connection.prompt(this.session.sessionId, text)
      this.running = true
      await this.onChanged()
    } catch (error) {
      void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error))
    } finally {
      this.busy = false
      await this.show().catch(() => undefined)
    }
  }

  private async stop(): Promise<void> {
    if (!this.running || this.cancelling) return
    this.cancelling = true
    void this.show()
    try {
      await this.connection.cancelSession(this.session.sessionId)
      await this.onChanged()
    } catch (error) {
      this.cancelling = false
      void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error))
      await this.show().catch(() => undefined)
    }
  }

  private async selectModel(provider: string, modelId: string, reasoningEffort?: string): Promise<void> {
    const catalog = this.modelCatalog ?? await this.connection.models(this.session.sessionId)
    if (!catalog.routable) return
    const group = catalog.groups.find(item => item.id === provider)
    const model = group?.models.find(item => item.id === modelId)
    if (model === undefined) return
    if (reasoningEffort !== undefined && !model.reasoning?.efforts.some(item => item.id === reasoningEffort)) return
    await this.connection.selectModel(this.session.sessionId, { provider, model: modelId, ...(reasoningEffort ? { reasoningEffort } : {}) })
    this.modelCatalog = { ...catalog, current: { provider, model: modelId, ...(reasoningEffort ? { reasoningEffort } : {}) } }
    this.modelLabel = model.name
    await this.show()
  }

  private async selectPermission(preset: string): Promise<void> {
    const permissions = permissionSelect(this.projectionValues)
    if (permissions === undefined || !permissions.options.some(option => option.value === preset && option.value !== 'custom')) return
    const confirm = preset === 'danger-full-access'
      ? await vscode.window.showWarningMessage('Enable full access for this session? Harness may modify files and run commands without asking.', { modal: true }, 'Enable Full Access')
      : 'Enable Full Access'
    if (confirm !== 'Enable Full Access') return
    await this.connection.selectPermission(this.session.sessionId, preset)
    const value = this.projectionValues.permissions
    if (isRecord(value)) this.projectionValues = { ...this.projectionValues, permissions: { ...value, currentValue: preset } }
    await this.show()
  }

  private async answerApproval(approvalId: string, outcome: 'allowed-once' | 'rejected'): Promise<void> {
    const approval = this.approvals.find(item => item.approvalId === approvalId)
    if (!approval) return
    await this.connection.respondApproval(approval.frameRpcId, approval.sessionId, approval.approvalId, outcome)
    this.approvals = this.approvals.filter(item => item !== approval)
    await this.show()
  }
}

function renderSession(webview: vscode.Webview, session: RemoteSession, messages: ChatMessage[], approvals: PendingApproval[], busy: boolean, running: boolean, cancelling: boolean, modelLabel: string, catalog: SessionModels | undefined, projections: Record<string, unknown>): string {
  const nonce = crypto.randomUUID().replaceAll('-', '')
  const content = messages.length === 0
    ? '<div class="empty"><div class="emptyMark">◡</div><strong>What can I help you build?</strong><span>Send a message to start this remote Harness session.</span></div>'
    : messages.map(message => message.role === 'tool' ? renderToolMessage(message) : `<article class="message ${message.role}">${message.role === 'assistant' ? `<div class="avatar">${fishLogo()}</div>` : ''}<div class="bubble"><header>${message.role === 'user' ? 'You' : 'DeepSeek Harness'}</header><div class="messageText">${message.role === 'assistant' ? markdown.render(message.text) : escapeHtml(message.text).replaceAll('\n', '<br>')}</div></div></article>`).join('')
  const approvalCards = approvals.map(item => `<section class="approval"><div><strong>Approval required</strong><span>${escapeHtml(item.toolName)}${item.reason ? ` · ${escapeHtml(item.reason)}` : ''}</span></div><div class="approvalActions"><button type="button" class="secondary approvalButton" data-id="${escapeHtml(item.approvalId)}" data-outcome="rejected">Deny</button><button type="button" class="approvalButton" data-id="${escapeHtml(item.approvalId)}" data-outcome="allowed-once">Allow once</button></div></section>`).join('')
  const permissions = permissionSelect(projections)
  const statistics = sessionStatistics(projections)
  const modelMenu = renderModelMenu(catalog)
  const permissionMenu = permissions === undefined ? '' : `<div class="selectMenu" id="permissionMenu" hidden><div class="menuTitle">Approval level</div>${permissions.options.filter(option => option.value !== 'custom').map(option => `<button type="button" class="menuOption permissionOption${option.value === permissions.currentValue ? ' selected' : ''}" data-preset="${escapeHtml(option.value)}"><strong>${escapeHtml(option.name)}</strong>${option.description ? `<span>${escapeHtml(option.description)}</span>` : ''}</button>`).join('')}</div>`
  const actionButton = running
    ? `<button class="send stop" id="stop" type="button" aria-label="Stop" title="Stop" ${cancelling ? 'disabled' : ''}>Stop</button>`
    : `<button class="send" type="submit" aria-label="Send" title="Send (Enter) · New line (Shift+Enter)" ${busy ? 'disabled' : ''}>Send</button>`
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'"><style>
    :root{color-scheme:light dark}*{box-sizing:border-box}body{margin:0;color:var(--vscode-foreground);background:var(--vscode-editor-background);font-family:var(--vscode-font-family)}
    .layout{height:100vh;display:grid;grid-template-rows:auto 1fr auto}.top{padding:7px 20px 8px;border-bottom:1px solid var(--vscode-panel-border);background:var(--vscode-editor-background)}.meta{font-size:11px;color:var(--vscode-descriptionForeground);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .messages{overflow:auto;padding:28px max(24px,calc((100% - 820px)/2));display:flex;flex-direction:column;gap:24px;scrollbar-gutter:stable}.message{width:min(100%,820px);line-height:1.65;display:flex;gap:12px}.message.user{align-self:flex-end;justify-content:flex-end}.message.user .bubble{max-width:78%;background:var(--vscode-textBlockQuote-background);padding:10px 14px;border-radius:10px}.message.assistant{align-self:flex-start}.message.assistant .bubble{padding-top:1px;min-width:0;max-width:calc(100% - 38px)}.avatar{width:26px;height:26px;flex:0 0 26px;display:grid;place-items:center;color:var(--vscode-foreground)}.avatar svg{width:23px;height:auto}.message.tool{align-self:flex-start;width:min(100%,820px);gap:9px;color:var(--vscode-descriptionForeground);font-size:12px;line-height:18px}.toolIcon{width:20px;height:20px;flex:0 0 20px;display:grid;place-items:center;color:var(--vscode-descriptionForeground)}.toolIcon svg{width:15px;height:15px}.toolBody{min-width:0;padding-top:1px}.toolLine{display:flex;align-items:baseline;gap:7px;min-width:0}.toolTitle{color:var(--vscode-foreground);font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.toolState{flex:0 0 auto;color:var(--vscode-descriptionForeground);font-size:11px}.toolState.running::before{content:'◌';display:inline-block;margin-right:4px;animation:spin 1s linear infinite}.toolState.completed::before{content:'✓';margin-right:4px}.toolState.failed{color:var(--vscode-errorForeground)}.toolState.failed::before{content:'×';margin-right:4px}.toolDetail{max-width:680px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--vscode-descriptionForeground);font-family:var(--vscode-editor-font-family);font-size:11px}@keyframes spin{to{transform:rotate(360deg)}}.message header{font-size:11px;font-weight:600;color:var(--vscode-descriptionForeground);margin-bottom:5px}.message.user header{display:none}.messageText>:first-child{margin-top:0}.messageText>:last-child{margin-bottom:0}.messageText p{margin:0 0 12px}.messageText h1,.messageText h2,.messageText h3{line-height:1.3;margin:20px 0 9px}.messageText h1{font-size:1.35em}.messageText h2{font-size:1.2em}.messageText h3{font-size:1.08em}.messageText pre{overflow:auto;padding:12px;border:1px solid var(--vscode-panel-border);border-radius:6px;background:var(--vscode-textCodeBlock-background)}.messageText code{font-family:var(--vscode-editor-font-family);font-size:.92em}.messageText :not(pre)>code{padding:1px 4px;border-radius:3px;background:var(--vscode-textCodeBlock-background)}.messageText blockquote{margin:10px 0;padding-left:12px;border-left:2px solid var(--vscode-textBlockQuote-border);color:var(--vscode-descriptionForeground)}.messageText a{color:var(--vscode-foreground)}.messageText table{border-collapse:collapse}.messageText td,.messageText th{border:1px solid var(--vscode-panel-border);padding:5px 8px}.empty{margin:auto;display:flex;flex-direction:column;align-items:center;gap:7px;color:var(--vscode-descriptionForeground);text-align:center}.empty strong{font-size:16px;color:var(--vscode-foreground)}.emptyMark{width:42px;height:42px;border-radius:13px;display:grid;place-items:center;background:var(--vscode-foreground);color:var(--vscode-editor-background);font-size:25px;font-weight:700}.empty span{font-size:12px}
    .composerSeat{position:relative;background:linear-gradient(180deg,transparent 0,var(--vscode-editor-background) 34px);padding:8px 16px 6px}.approval{width:100%;max-width:748px;margin:0 auto 12px;border:1px solid var(--vscode-inputValidation-warningBorder);border-radius:20px;background:var(--vscode-input-background);box-shadow:0 5px 18px var(--vscode-widget-shadow,transparent);overflow:hidden}.approval>div:first-child{padding:12px 16px 0}.approval strong{font-size:15px;font-weight:500}.approval span{display:block;margin-top:4px;font:13px/20px var(--vscode-editor-font-family);color:var(--vscode-descriptionForeground)}.approvalActions{display:flex;justify-content:flex-end;gap:8px;padding:14px 16px}.approvalActions .approvalButton{width:auto;height:30px;padding:0 12px;border:1px solid var(--vscode-foreground);border-radius:999px;color:var(--vscode-editor-background);background:var(--vscode-foreground);font-size:12px}.approvalActions .approvalButton::after{content:none}.approvalActions .secondary{color:var(--vscode-foreground);background:transparent;border:1px solid var(--vscode-panel-border)}form{box-sizing:border-box;width:100%;max-width:780px;margin:0 auto;border:1px solid var(--vscode-input-border);border-radius:22px;background:var(--vscode-input-background);box-shadow:0 5px 18px var(--vscode-widget-shadow,transparent);display:flex;flex-direction:column;gap:8px;padding:10px 8px 6px}textarea{width:100%;min-height:52px;max-height:336px;resize:none;outline:0;color:var(--vscode-input-foreground);background:transparent;border:0;padding:4px 8px;font:16px/24px var(--vscode-font-family)}.composerRow{display:flex;align-items:center;justify-content:space-between;gap:12px;min-width:0}.modes{display:flex;align-items:center;gap:4px;min-width:0}.modeButton{width:auto;max-width:220px;height:28px;color:var(--vscode-descriptionForeground);background:transparent;border:0;border-radius:24px;padding:0 8px;font-size:13px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.modeButton::after{content:'⌄';font-size:12px;margin-left:5px}.modeButton:hover,.modeButton.open{background:var(--vscode-toolbar-hoverBackground)}.selectMenu{position:absolute;z-index:20;left:max(16px,calc((100% - 780px)/2));bottom:66px;width:min(360px,calc(100% - 32px));max-height:min(420px,55vh);overflow:auto;padding:6px;border:1px solid var(--vscode-widget-border,var(--vscode-panel-border));border-radius:10px;background:var(--vscode-menu-background,var(--vscode-input-background));box-shadow:0 8px 28px var(--vscode-widget-shadow,transparent)}.selectMenu[hidden]{display:none}.menuTitle,.menuGroup{padding:6px 8px;color:var(--vscode-descriptionForeground);font-size:11px;font-weight:600}.menuGroup{padding-top:10px;text-transform:uppercase}.menuOption{display:block;width:100%;height:auto;min-height:34px;padding:7px 9px;text-align:left;color:var(--vscode-menu-foreground,var(--vscode-foreground));background:transparent;border:0;border-radius:5px}.menuOption:hover{background:var(--vscode-list-hoverBackground)}.menuOption.selected{background:var(--vscode-foreground);color:var(--vscode-editor-background)}.menuOption strong{display:block;font-size:13px;font-weight:500}.menuOption span{display:block;margin-top:2px;color:var(--vscode-descriptionForeground);font-size:11px;line-height:15px}.effort{padding-left:22px}.send{align-self:center;width:34px;height:34px;border-radius:999px;color:var(--vscode-editor-background);background:var(--vscode-foreground);border:0;cursor:pointer;font-size:0}.send::after{content:'↑';font-size:18px;font-weight:600}.send.stop::after{content:'■';font-size:13px}.send:hover{opacity:.82}button:disabled{opacity:.45;cursor:default}.statistics{width:100%;max-width:780px;margin:6px auto 0;display:flex;justify-content:center;align-items:center;flex-wrap:wrap;color:var(--vscode-descriptionForeground);font-size:11px;line-height:18px}.stat{white-space:nowrap}.stat+.stat::before{content:'|';padding:0 7px;color:var(--vscode-panel-border)}
  </style></head><body><div class="layout"><header class="top"><div class="meta">${escapeHtml(session.cwd ?? session.sessionId)}</div></header><main class="messages" id="messages">${content}</main><div class="composerSeat">${approvalCards}${modelMenu}${permissionMenu}<form id="composer"><textarea id="prompt" aria-label="Prompt" placeholder="Ask DeepSeek Harness…" ${busy ? 'disabled' : ''}></textarea><div class="composerRow"><div class="modes"><button type="button" class="modeButton" id="model">${escapeHtml(modelLabel)}</button>${permissions === undefined ? '' : `<button type="button" class="modeButton" id="permission">${escapeHtml(permissions.currentName)}</button>`}</div>${actionButton}</div></form>${statistics}</div></div><script nonce="${nonce}">const vscode=acquireVsCodeApi();const messages=document.getElementById('messages');messages.scrollTop=messages.scrollHeight;const form=document.getElementById('composer');const prompt=document.getElementById('prompt');const modelButton=document.getElementById('model');const permissionButton=document.getElementById('permission');const modelMenu=document.getElementById('modelMenu');const permissionMenu=document.getElementById('permissionMenu');function toggle(menu,button){const open=menu?.hidden===true;document.querySelectorAll('.selectMenu').forEach(item=>item.hidden=true);document.querySelectorAll('.modeButton').forEach(item=>item.classList.remove('open'));if(open&&menu){menu.hidden=false;button?.classList.add('open');}}modelButton.addEventListener('click',()=>toggle(modelMenu,modelButton));permissionButton?.addEventListener('click',()=>toggle(permissionMenu,permissionButton));document.getElementById('stop')?.addEventListener('click',()=>vscode.postMessage({type:'stop'}));form.addEventListener('submit',event=>{event.preventDefault();const text=prompt.value.trim();if(text){vscode.postMessage({type:'send',text});prompt.value='';}});prompt.addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();form.requestSubmit();}if(event.key==='Escape'){document.querySelectorAll('.selectMenu').forEach(item=>item.hidden=true);}});document.querySelectorAll('.modelOption').forEach(button=>button.addEventListener('click',()=>vscode.postMessage({type:'modelSelect',provider:button.dataset.provider,model:button.dataset.model,...(button.dataset.effort?{reasoningEffort:button.dataset.effort}:{})})));document.querySelectorAll('.permissionOption').forEach(button=>button.addEventListener('click',()=>vscode.postMessage({type:'permissionSelect',preset:button.dataset.preset})));document.querySelectorAll('.approvalButton').forEach(button=>button.addEventListener('click',()=>vscode.postMessage({type:'approval',id:button.dataset.id,outcome:button.dataset.outcome})));</script></body></html>`
}

function renderLoadingSession(webview: vscode.Webview, session: RemoteSession): string {
  const nonce = crypto.randomUUID().replaceAll('-', '')
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'"><style>:root{color-scheme:light dark}*{box-sizing:border-box}body{margin:0;background:var(--vscode-editor-background);color:var(--vscode-foreground);font-family:var(--vscode-font-family)}.root{height:100vh;display:flex;flex-direction:column}.top{height:32px;padding:7px 20px;border-bottom:1px solid var(--vscode-panel-border);font-size:11px;color:var(--vscode-descriptionForeground)}.column{width:min(calc(100% - 48px),748px);margin:16px auto;display:flex;flex-direction:column;gap:16px}.loading{height:26px;font-size:14px;font-weight:600;display:flex;align-items:center;background:linear-gradient(90deg,var(--vscode-foreground) 0%,var(--vscode-foreground) 40%,color-mix(in srgb,var(--vscode-foreground) 35%,transparent) 50%,var(--vscode-foreground) 60%,var(--vscode-foreground) 100%);color:transparent;background-size:250% 100%;background-clip:text;animation:shimmer 1.8s linear infinite}.line{height:12px;border-radius:6px;background:var(--vscode-toolbar-hoverBackground);animation:pulse 1.2s ease-in-out infinite alternate}.line:nth-child(2){width:82%}.line:nth-child(3){width:64%}@keyframes shimmer{to{background-position:-250% 0}}@keyframes pulse{to{opacity:.42}}@media(prefers-reduced-motion:reduce){.loading,.line{animation:none}}</style></head><body><div class="root"><div class="top">${escapeHtml(session.cwd ?? session.sessionId)}</div><main class="column"><div class="loading">Loading history…</div><div class="line"></div><div class="line"></div></main></div></body></html>`
}

function escapeHtml(value: string): string { return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;') }
function renderToolMessage(message: ChatMessage): string {
  const state = message.toolState ?? 'running'
  const detail = message.toolDetail ? `<div class="toolDetail" title="${escapeHtml(message.toolDetail)}">${escapeHtml(message.toolDetail)}</div>` : ''
  return `<article class="message tool" data-card="${escapeHtml(message.toolCard ?? '')}"><div class="toolIcon">${toolIcon(message.toolKind)}</div><div class="toolBody"><div class="toolLine"><span class="toolTitle">${escapeHtml(message.text)}</span><span class="toolState ${state}">${toolStateLabel(state)}</span></div>${detail}</div></article>`
}
function toolIcon(kind: string | undefined): string {
  const paths: Record<string, string> = {
    read: '<path d="M3 4.5h6l2 2h10v12H3zM3 8h18"/>',
    edit: '<path d="M4 20l4.2-1 10.9-10.9-3.2-3.2L5 15.8 4 20zm10-13 3.2 3.2"/>',
    delete: '<path d="M5 7h14M9 7V4h6v3m2 0-1 13H8L7 7m3 4v5m4-5v5"/>',
    move: '<path d="M12 3v18m0-18-3 3m3-3 3 3M3 12h18m-18 0 3-3m-3 3 3 3m15-3-3-3m3 3-3 3"/>',
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/>',
    execute: '<path d="m5 7 5 5-5 5m7 0h7"/>',
    fetch: '<path d="M12 3v12m0 0-4-4m4 4 4-4M5 20h14"/>',
    other: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  }
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[kind ?? ''] ?? paths.other}</svg>`
}
function fishLogo(): string { return '<svg viewBox="0 0 23.16 17.04" fill="none" aria-hidden="true"><path fill="currentColor" d="M22.9168 1.43018C22.6713 1.31018 22.5658 1.53918 22.4223 1.65519C22.3733 1.69269 22.3318 1.74169 22.2903 1.78669C21.9317 2.1697 21.5127 2.42121 20.9657 2.39121C20.1657 2.34621 19.4827 2.59771 18.8787 3.20973C18.7502 2.45521 18.3236 2.0047 17.6746 1.71569C17.3351 1.56568 16.9916 1.41518 16.7536 1.08867C16.5876 0.856163 16.5421 0.597155 16.4591 0.341647C16.4061 0.187643 16.3536 0.0301382 16.1761 0.00363739C15.9836 -0.0263635 15.9081 0.135141 15.8326 0.270145C15.5306 0.822162 15.4136 1.43018 15.4251 2.0462C15.4516 3.43174 16.0366 4.53527 17.1991 5.3203C17.3311 5.4103 17.3651 5.5003 17.3236 5.63181C17.2441 5.90231 17.1501 6.16482 17.0671 6.43533C17.0141 6.60784 16.9351 6.64584 16.7501 6.57033C16.1121 6.30383 15.5611 5.90931 15.074 5.4328C14.2475 4.63328 13.5 3.75075 12.568 3.05973C12.349 2.89822 12.13 2.74822 11.9034 2.60522C10.9524 1.68169 12.028 0.923165 12.277 0.833162C12.5375 0.739159 12.3675 0.41615 11.5259 0.42015C10.6844 0.42365 9.91439 0.705658 8.93286 1.08117C8.78935 1.13767 8.63835 1.17867 8.48384 1.21267C7.59332 1.04367 6.66829 1.00617 5.70226 1.11517C3.88321 1.31768 2.43016 2.1777 1.36213 3.64575C0.0790928 5.4103 -0.222916 7.41536 0.146595 9.50642C0.535106 11.7105 1.66014 13.535 3.38869 14.9616C5.18125 16.4406 7.24581 17.1657 9.60138 17.0266C11.0319 16.9441 12.6245 16.7526 14.421 15.2321C14.874 15.4576 15.3496 15.5476 16.1381 15.6151C16.7456 15.6716 17.3306 15.5851 17.7836 15.4911C18.4931 15.3411 18.4441 14.6841 18.1876 14.5636C16.1081 13.595 16.5646 13.9891 16.1496 13.67C17.2061 12.42 18.8202 10.1979 19.3182 7.17235C19.3672 6.83834 19.4297 6.36783 19.4222 6.09732C19.4182 5.93231 19.4562 5.86831 19.6447 5.84931C20.1657 5.78931 20.6712 5.64681 21.1357 5.3913C22.4833 4.65528 23.0268 3.44624 23.1548 1.9972C23.1738 1.77569 23.1508 1.54668 22.9168 1.43018ZM11.1749 14.4736C9.15936 12.889 8.18184 12.3675 7.77832 12.39C7.40081 12.4125 7.46881 12.8445 7.55182 13.126C7.63882 13.404 7.75182 13.5955 7.91033 13.8396C8.01983 14.0011 8.09533 14.2411 7.80083 14.4216C7.15181 14.8231 6.02327 14.2866 5.97027 14.2601C4.65673 13.4865 3.5587 12.4655 2.78467 11.069C2.03715 9.72493 1.60314 8.28289 1.53164 6.74384C1.51264 6.37233 1.62214 6.24082 1.99215 6.17332C2.47916 6.08332 2.98118 6.06432 3.46769 6.13582C5.52476 6.43633 7.27581 7.35586 8.74385 8.8129C9.58188 9.64243 10.2159 10.634 10.8689 11.6025C11.5634 12.631 12.3105 13.611 13.262 14.4146C13.598 14.6961 13.866 14.9101 14.1225 15.0681C13.349 15.1546 12.058 15.1731 11.1749 14.4746L11.1749 14.4736ZM12.141 8.25988C12.141 8.09488 12.273 7.96338 12.439 7.96338C12.4765 7.96338 12.5105 7.97088 12.541 7.98188C12.5825 7.99688 12.6205 8.01938 12.6505 8.05338C12.7035 8.10588 12.7335 8.18088 12.7335 8.25988C12.7335 8.42489 12.6015 8.55639 12.4355 8.55639C12.2695 8.55639 12.141 8.42489 12.141 8.25988ZM15.1415 9.79893C14.949 9.87793 14.7565 9.94544 14.5715 9.95294C14.2845 9.96794 13.9715 9.85143 13.8015 9.70893C13.5375 9.48742 13.3485 9.36342 13.2695 8.97691C13.2355 8.8119 13.2545 8.55639 13.2845 8.40989C13.3525 8.09438 13.277 7.89187 13.0545 7.70787C12.8735 7.55786 12.643 7.51636 12.39 7.51636C12.2955 7.51636 12.209 7.47486 12.1445 7.44136C12.039 7.38886 11.9519 7.25735 12.035 7.09585C12.0615 7.04335 12.19 6.91584 12.22 6.89334C12.5635 6.69784 12.9595 6.76184 13.326 6.90834C13.6655 7.04735 13.9225 7.30236 14.292 7.66287C14.6695 8.09838 14.7375 8.21838 14.9525 8.54539C15.1225 8.8009 15.277 9.06341 15.3831 9.36392C15.4471 9.55142 15.3641 9.70493 15.1415 9.79893Z"/></svg>' }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }

function toolStateLabel(state: ChatMessage['toolState']): string {
  const zh = vscode.env.language.toLowerCase().startsWith('zh')
  if (state === 'failed') return zh ? '失败' : 'Failed'
  if (state === 'completed') return zh ? '已完成' : 'Completed'
  return zh ? '运行中' : 'Running'
}

function loginCopy() {
  if (vscode.env.language.toLowerCase().startsWith('zh')) return {
    overview: '安全连接远端 DeepSeek Harness Host，在 VS Code 中继续查看 Workspace 和对话。',
    requirementBefore: '使用前，远端电脑的 DeepSeek Harness 必须先安装并启用',
    requirementAfter: '插件，并与 VS Code 登录同一账号。',
    openSettings: '打开设置', qrLogin: '二维码登录', passwordLogin: '账号密码',
    generating: '正在生成…', generateQr: '生成二维码', regenerateQr: '重新生成二维码',
    scanHint: '使用知乎扫码授权当前设备。', email: '邮箱', password: '密码', signIn: '登录', signingIn: '正在登录…',
    passwordHint: '仅限邀请码或自建账号，非 DeepSeek 官方。',
  }
  return {
    overview: 'Securely connect to a remote DeepSeek Harness Host and continue its workspaces and conversations in VS Code.',
    requirementBefore: 'Before signing in, install and enable the',
    requirementAfter: 'plugin on the remote DeepSeek Harness computer, then use the same account on both devices.',
    openSettings: 'Open settings', qrLogin: 'QR Login', passwordLogin: 'Account & Password',
    generating: 'Generating…', generateQr: 'Generate QR Code', regenerateQr: 'Generate a new code',
    scanHint: 'Scan with Zhihu to authorize this device.', email: 'Email', password: 'Password', signIn: 'Sign In', signingIn: 'Signing in…',
    passwordHint: 'Invite or self-hosted accounts only; not DeepSeek official.',
  }
}

function renderModelMenu(catalog: SessionModels | undefined): string {
  if (catalog === undefined || !catalog.routable) return ''
  const groups = catalog.groups.map(group => {
    const options = group.models.map(model => {
      const efforts = model.reasoning?.efforts ?? []
      if (efforts.length === 0) {
        const selected = catalog.current.provider === group.id && catalog.current.model === model.id
        return `<button type="button" class="menuOption modelOption${selected ? ' selected' : ''}" data-provider="${escapeHtml(group.id)}" data-model="${escapeHtml(model.id)}"><strong>${escapeHtml(model.name)}</strong>${model.description ? `<span>${escapeHtml(model.description)}</span>` : ''}</button>`
      }
      return `<div class="menuOptionLabel"><div class="menuGroup">${escapeHtml(model.name)}</div></div>${efforts.map(effort => {
        const selected = catalog.current.provider === group.id && catalog.current.model === model.id && catalog.current.reasoningEffort === effort.id
        return `<button type="button" class="menuOption modelOption effort${selected ? ' selected' : ''}" data-provider="${escapeHtml(group.id)}" data-model="${escapeHtml(model.id)}" data-effort="${escapeHtml(effort.id)}"><strong>${escapeHtml(effort.name)}</strong>${effort.description ? `<span>${escapeHtml(effort.description)}</span>` : ''}</button>`
      }).join('')}`
    }).join('')
    return `<div class="menuGroup">${escapeHtml(group.name)}</div>${options}`
  }).join('')
  return `<div class="selectMenu" id="modelMenu" hidden><div class="menuTitle">Model</div>${groups}</div>`
}

function permissionSelect(values: Record<string, unknown>): { currentName: string; currentValue: string; options: Array<{ value: string; name: string; description?: string }> } | undefined {
  const source = values.permissions
  if (!isRecord(source) || typeof source.currentValue !== 'string' || !Array.isArray(source.options)) return undefined
  const options = source.options.flatMap(option => {
    if (!isRecord(option) || typeof option.value !== 'string' || typeof option.name !== 'string') return []
    return [{ value: option.value, name: option.name, ...(typeof option.description === 'string' ? { description: option.description } : {}) }]
  })
  const current = options.find(option => option.value === source.currentValue)
  return { currentName: current?.name ?? source.currentValue, currentValue: source.currentValue, options }
}

function sessionStatistics(values: Record<string, unknown>): string {
  const stats = isRecord(values.sessionStats) ? values.sessionStats : undefined
  const usage = isRecord(values.tokenUsage) ? values.tokenUsage : undefined
  if (stats === undefined && usage === undefined) return ''
  const turns = finiteNumber(stats?.turns)
  const steps = finiteNumber(stats?.steps)
  const llmMs = finiteNumber(stats?.llmMs)
  const toolMs = finiteNumber(stats?.toolMs)
  const ttftMs = finiteNumber(stats?.ttftMs)
  const ttftSteps = finiteNumber(stats?.ttftSteps)
  const decodeMs = finiteNumber(stats?.decodeMs)
  const decodeTokens = finiteNumber(stats?.decodeTokens)
  const uncachedInput = finiteNumber(usage?.uncachedInputTokens)
  const cacheRead = finiteNumber(usage?.cacheReadTokens)
  const cacheWrite = finiteNumber(usage?.cacheWriteTokens)
  const output = finiteNumber(usage?.outputTokens)
  const input = uncachedInput + cacheRead + cacheWrite
  const cacheRate = input > 0 ? cacheRead / input * 100 : 0
  const ttft = ttftSteps > 0 ? ttftMs / ttftSteps / 1_000 : 0
  const speed = decodeMs > 0 ? decodeTokens / (decodeMs / 1_000) : 0
  const groups = [
    `${formatInteger(turns)} 轮 · ${formatInteger(steps)} 步`,
    `LLM ${formatDuration(llmMs)} · 工具调用 ${formatDuration(toolMs)}`,
    `首 token 平均 ${formatSeconds(ttft)} · ${formatRate(speed)} tok/s`,
    `缓存命中 ${Math.round(cacheRate)}%`,
    `输入 ${formatTokens(input)} tok · 输出 ${formatTokens(output)} tok`,
  ]
  return `<div class="statistics" aria-label="Session statistics">${groups.map(group => `<span class="stat">${escapeHtml(group)}</span>`).join('')}</div>`
}

function finiteNumber(value: unknown): number { return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0 }
function formatInteger(value: number): string { return Math.round(value).toLocaleString('en-US') }
function formatSeconds(value: number): string { return value < 10 ? `${value.toFixed(1)}s` : `${Math.round(value)}s` }
function formatRate(value: number): string { return value < 10 ? value.toFixed(1) : Math.round(value).toString() }
function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1_000)
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  return `${minutes > 0 ? `${minutes}m` : ''}${rest}s`
}
function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${Math.round(value / 1_000)}K`
  return formatInteger(value)
}

type RemoteTreeItem = HostItem | WorkspaceItem | SessionItem
class RemoteExplorerProvider implements vscode.TreeDataProvider<RemoteTreeItem> {
  private readonly changed = new vscode.EventEmitter<void>(); readonly onDidChangeTreeData = this.changed.event
  constructor(private readonly children: (element?: RemoteTreeItem) => Promise<RemoteTreeItem[]>) {}
  fire(): void { this.changed.fire() }
  getTreeItem(item: RemoteTreeItem): vscode.TreeItem { return item }
  getChildren(element?: RemoteTreeItem): Promise<RemoteTreeItem[]> { return this.children(element) }
}
class HostItem extends vscode.TreeItem {
  readonly contextValue = 'dshRemote.host'
  constructor(readonly host: RemoteHost, connected: boolean) {
    super(host.name, vscode.TreeItemCollapsibleState.Collapsed)
    this.description = connected ? 'Connected · Online' : host.online ? 'Online' : 'Offline'
    this.tooltip = `${host.name} · ${this.description} · ${host.platform}${host.harnessVersion ? ` · Harness ${host.harnessVersion}` : ''}`
    this.iconPath = new vscode.ThemeIcon(
      connected ? 'remote-explorer' : 'circle-filled',
      new vscode.ThemeColor(connected || host.online ? 'testing.iconPassed' : 'disabledForeground'),
    )
  }
}
class WorkspaceItem extends vscode.TreeItem {
  readonly contextValue = 'dshRemote.workspace'
  constructor(readonly workspace: RemoteWorkspace) { super(workspace.title || workspace.path, vscode.TreeItemCollapsibleState.Collapsed); this.description = workspace.path; this.iconPath = new vscode.ThemeIcon('folder') }
}
class SessionItem extends vscode.TreeItem {
  readonly contextValue = 'dshRemote.session'
  constructor(readonly session: RemoteSession) { super(sessionTitle(session)); this.description = session.running ? 'running' : relativeTime(session.updatedAt); this.tooltip = session.cwd; this.iconPath = new vscode.ThemeIcon(session.running ? 'loading~spin' : 'comment-discussion'); this.command = { command: 'dshRemote.openSession', title: 'Open Session', arguments: [this] } }
}

function sessionTitle(session: RemoteSession): string {
  const values = session.projections?.values
  const metadata = isRecord(values?.sessionListMetadata) ? values.sessionListMetadata : undefined
  const candidates: unknown[] = [
    metadata?.title,
    values?.title,
    values?.sessionTitle,
    values?.conversationTitle,
    isRecord(values?.summary) ? values.summary.title : undefined,
    isRecord(values?.metadata) ? values.metadata.title : undefined,
    session.title,
  ]
  for (const value of candidates) if (typeof value === 'string' && value.trim()) return value.trim()
  if (values) {
    for (const [key, value] of Object.entries(values)) if (/title/i.test(key) && typeof value === 'string' && value.trim()) return value.trim()
  }
  return session.parentSessionId ? 'Subtask session' : 'New session'
}

function relativeTime(value: number): string {
  const elapsed = Math.max(0, Date.now() - value)
  if (elapsed < 60_000) return 'now'
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m`
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}h`
  return `${Math.floor(elapsed / 86_400_000)}d`
}
