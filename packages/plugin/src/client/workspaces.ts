import { renderBodyPortal } from './portal.js'
import QRCode from 'qrcode'
import type { Translate } from '../client-locale.js'
import type { OAuthProviderInfo } from '../server-api.js'
import type { StatusFeed } from '../status-stream.js'
import { compareVersions } from '../version-compare.js'
import { deepSeekWorkspaceIcon, gptWorkspaceIcon } from './icons.js'
import { pendingWorkspaceSelectionKey } from './navigation.js'
import { connectedClientModeLabel, connectedProgress, connectionErrorMessage, formatPlatform, messageOf } from './presentation.js'
import { createRemoteProgressView, runConnectHostProgress } from './progress.js'
import type {
  ClientReact,
  CodexWorkspaceView,
  CursorWorkspaceView,
  LoginMethod,
  OAuthProvider,
  OAuthQrPollResult,
  OAuthQrSession,
  RemoteConnectionProgress,
  RemoteDevice,
  RemoteDirectoryListing,
  RemoteStatus,
  RemoteWorkspaceView,
  PluginSettingsView,
  PortalRenderer,
  SidebarEntryPreference,
  SidebarEntryStyle,
} from './types.js'

export function createRemoteWorkspaceAction(React: ClientReact, portal?: PortalRenderer) {
  const RemoteProgressView = createRemoteProgressView(React)

  /**
   * Renders the Compact entry at the end of the host account row. The host
   * exposes no slot there, so the button is portalled into the settings row; the
   * Standard entry stays in place until that row exists, so nothing is lost when
   * the sidebar is collapsed.
   */
  function RemoteAccountEntry(props: {
    portal: PortalRenderer | undefined
    fallback: unknown
    children: unknown
  }): unknown {
    const [container, setContainer] = React.useState<Element | null>(null)
    const { portal } = props
    React.useEffect(() => {
      if (portal === undefined) return undefined
      let attempt = 0
      let timer: number | undefined
      let host: HTMLElement | undefined
      let observer: MutationObserver | undefined
      const attach = (): void => {
        const row = document.querySelector('[class*="settingsArea"] [class*="triggerRow"]')
        if (row === null) {
          // The row mounts with the footer area; give the host a moment before
          // settling for the Standard entry.
          if (attempt < 40) {
            attempt += 1
            timer = window.setTimeout(attach, 50)
          }
          return
        }
        host = document.createElement('span')
        // The host re-renders its row without React knowing about this node, so
        // put it back whenever it is dropped.
        observer = new MutationObserver(() => {
          if (host !== undefined && !host.isConnected) row.append(host)
        })
        observer.observe(row, { childList: true })
        row.append(host)
        setContainer(host)
      }
      attach()
      return () => {
        if (timer !== undefined) window.clearTimeout(timer)
        observer?.disconnect()
        host?.remove()
      }
    }, [portal])
    if (typeof portal !== 'function' || container === null) return props.fallback
    // The Compact entry is portalled into a host-owned row, so a stale or
    // detached container must not blank the sidebar; fall back in place.
    try {
      return portal(props.children, container)
    } catch {
      return props.fallback
    }
  }

  function RemoteWorkspaceAction(props: {
    wide: boolean
    control: <T>(endpoint: string, payload?: unknown) => Promise<T>
    statusFeed: StatusFeed<RemoteStatus>
    subscribeOpen: (listener: () => void) => () => void
    preferredQrProvider: OAuthProvider
    sidebarEntry: SidebarEntryPreference
    portal?: PortalRenderer
    t: Translate
    openSettings?: () => void
  }): unknown {
    const { t } = props
    const connectionErrorMessageFor = (reason: unknown, translate: Translate): string => {
      if (typeof reason === 'object' && reason !== null && 'code' in reason) {
        const code = (reason as { code?: unknown }).code
        if (typeof code === 'string') return connectionErrorMessage(code, translate)
      }
      return messageOf(reason)
    }
    const [open, setOpen] = React.useState(false)
    const [status, setStatus] = React.useState<RemoteStatus | undefined>(undefined)
    const [devices, setDevices] = React.useState<RemoteDevice[]>([])
    const [selectedHost, setSelectedHost] = React.useState<RemoteDevice | undefined>(undefined)
    // The Host being connected right now: its row stays visible as a collapsed
    // summary so the progress panel below it is on screen without scrolling.
    const [connectingHost, setConnectingHost] = React.useState<RemoteDevice | undefined>(undefined)
    const [workspaces, setWorkspaces] = React.useState<RemoteWorkspaceView[]>([])
    const [codexWorkspaces, setCodexWorkspaces] = React.useState<CodexWorkspaceView[]>([])
    const [cursorWorkspaces, setCursorWorkspaces] = React.useState<CursorWorkspaceView[]>([])
    const [antigravityWorkspaces, setAntigravityWorkspaces] = React.useState<CursorWorkspaceView[]>([])
    const [piWorkspaces, setPiWorkspaces] = React.useState<CursorWorkspaceView[]>([])
    const [opencodeWorkspaces, setOpencodeWorkspaces] = React.useState<CursorWorkspaceView[]>([])
    const [claudeWorkspaces, setClaudeWorkspaces] = React.useState<CursorWorkspaceView[]>([])
    const [hermesWorkspaces, setHermesWorkspaces] = React.useState<CursorWorkspaceView[]>([])
    const [workspaceBackend, setWorkspaceBackend] = React.useState<'harness' | 'codex' | 'cursor' | 'antigravity' | 'pi' | 'opencode' | 'claude' | 'hermes'>('harness')
    const [codexWorkspaceId, setCodexWorkspaceId] = React.useState<string | undefined>(undefined)
    const [cursorWorkspaceId, setCursorWorkspaceId] = React.useState<string | undefined>(undefined)
    const [antigravityWorkspaceId, setAntigravityWorkspaceId] = React.useState<string | undefined>(undefined)
    const [piWorkspaceId, setPiWorkspaceId] = React.useState<string | undefined>(undefined)
    const [opencodeWorkspaceId, setOpencodeWorkspaceId] = React.useState<string | undefined>(undefined)
    const [claudeWorkspaceId, setClaudeWorkspaceId] = React.useState<string | undefined>(undefined)
    const [hermesWorkspaceId, setHermesWorkspaceId] = React.useState<string | undefined>(undefined)
    const [directory, setDirectory] = React.useState<RemoteDirectoryListing | undefined>(undefined)
    const [path, setPath] = React.useState('')
    const [addingWorkspace, setAddingWorkspace] = React.useState(false)
    const [showAllWorkspaces, setShowAllWorkspaces] = React.useState(false)
    const [showAllCodexWorkspaces, setShowAllCodexWorkspaces] = React.useState(false)
    const [devicesOpen, setDevicesOpen] = React.useState(false)
    const [showAllCursorWorkspaces, setShowAllCursorWorkspaces] = React.useState(false)
    const [showAllAntigravityWorkspaces, setShowAllAntigravityWorkspaces] = React.useState(false)
    const [showAllPiWorkspaces, setShowAllPiWorkspaces] = React.useState(false)
    const [showAllOpencodeWorkspaces, setShowAllOpencodeWorkspaces] = React.useState(false)
    const [showAllClaudeWorkspaces, setShowAllClaudeWorkspaces] = React.useState(false)
    const [showAllHermesWorkspaces, setShowAllHermesWorkspaces] = React.useState(false)
    const workspaceListId = 'dsh-remote-workspace-list'
    const codexWorkspaceHeadingId = 'dsh-remote-codex-workspace-heading'
    const codexWorkspaceListId = 'dsh-remote-codex-workspace-list'
    const cursorWorkspaceHeadingId = 'dsh-remote-cursor-workspace-heading'
    const cursorWorkspaceListId = 'dsh-remote-cursor-workspace-list'
    const antigravityWorkspaceHeadingId = 'dsh-remote-antigravity-workspace-heading'
    const piWorkspaceHeadingId = 'dsh-remote-pi-workspace-heading'
    const opencodeWorkspaceHeadingId = 'dsh-remote-opencode-workspace-heading'
    const claudeWorkspaceHeadingId = 'dsh-remote-claude-workspace-heading'
    const hermesWorkspaceHeadingId = 'dsh-remote-hermes-workspace-heading'
    const antigravityWorkspaceListId = 'dsh-remote-antigravity-workspace-list'
    const piWorkspaceListId = 'dsh-remote-pi-workspace-list'
    const opencodeWorkspaceListId = 'dsh-remote-opencode-workspace-list'
    const claudeWorkspaceListId = 'dsh-remote-claude-workspace-list'
    const hermesWorkspaceListId = 'dsh-remote-hermes-workspace-list'
    const [busy, setBusy] = React.useState(false)
    // Remain undecided until local credentials or an explicit auth rejection
    // establish that login is required. Network failures are not sign-outs.
    const [needsAuthorization, setNeedsAuthorization] = React.useState<boolean | undefined>(undefined)
    const [email, setEmail] = React.useState('')
    const [password, setPassword] = React.useState('')
    const [loginServerUrl, setLoginServerUrl] = React.useState('https://dsh.r2049.cn')
    const [editingServer, setEditingServer] = React.useState(false)
    const [savingServer, setSavingServer] = React.useState(false)
    const serverDirty = loginServerUrl.trim() !== (status?.serverUrl ?? '')
    const [loginMethod, setLoginMethod] = React.useState<LoginMethod>('password')
    const loginMethodManuallySelected = React.useRef(false)
    const [oauthProviders, setOAuthProviders] = React.useState<OAuthProviderInfo[]>([])
    const [providersLoading, setProvidersLoading] = React.useState(false)
    const [providersFailed, setProvidersFailed] = React.useState(false)
    const [providerReload, setProviderReload] = React.useState(0)
    const providerRequestRun = React.useRef(0)
    const [qrSession, setQrSession] = React.useState<OAuthQrSession | undefined>(undefined)
    const [qrImage, setQrImage] = React.useState<string | undefined>(undefined)
    const [qrExpired, setQrExpired] = React.useState(false)
    const [hostEmail, setHostEmail] = React.useState('')
    const [hostPassword, setHostPassword] = React.useState('')
    const [hostRegistrationCode, setHostRegistrationCode] = React.useState('')
    const [progress, setProgress] = React.useState<RemoteConnectionProgress | undefined>(undefined)
    const progressRun = React.useRef(0)
    const qrFlowRun = React.useRef(0)
    const pageRef = React.useRef<HTMLElement | null>(null)
    const [notice, setNotice] = React.useState<string | undefined>(undefined)
    const [error, setError] = React.useState<string | undefined>(undefined)
    const [sidebarEntry, setSidebarEntry] = React.useState<SidebarEntryStyle>(() => props.sidebarEntry.read())

    // The settings page publishes the saved style, so the entry moves without a
    // reload; the first fetch below seeds it for a fresh page.
    React.useEffect(
      () => props.sidebarEntry.subscribe(() => setSidebarEntry(props.sidebarEntry.read())),
      [props.sidebarEntry],
    )
    React.useEffect(() => {
      void props.control<PluginSettingsView>('settings.get')
        .then(view => props.sidebarEntry.publish(view.config.sidebar?.entry ?? 'standard'))
        .catch(() => undefined)
    }, [props.control, props.sidebarEntry])

    React.useEffect(() => {
      if (!open) {
        setDevicesOpen(false)
        qrFlowRun.current += 1
        setBusy(false)
      }
    }, [open])

    React.useEffect(() => {
      if (!open) return
      const frame = window.requestAnimationFrame(() => pageRef.current?.focus())
      return () => window.cancelAnimationFrame(frame)
    }, [open])

    React.useEffect(() => {
      if (!open) return
      const closeOnEscape = (event: KeyboardEvent): void => {
        if (event.key !== 'Escape') return
        if (devicesOpen) {
          event.stopPropagation()
          setDevicesOpen(false)
          return
        }
        setOpen(false)
      }
      window.addEventListener('keydown', closeOnEscape)
      return () => window.removeEventListener('keydown', closeOnEscape)
    }, [open, devicesOpen])

    React.useEffect(() => {
      if (!devicesOpen) return
      const closeOnPointer = (event: MouseEvent): void => {
        const target = event.target
        if (!(target instanceof Element)) return
        if (target.closest('.dshRemoteConnectedMenu') !== null) return
        setDevicesOpen(false)
      }
      window.addEventListener('mousedown', closeOnPointer)
      return () => window.removeEventListener('mousedown', closeOnPointer)
    }, [devicesOpen])

    React.useEffect(() => {
      if ((status?.host?.connectedClients?.length ?? 0) === 0) setDevicesOpen(false)
    }, [status?.host?.connectedClients?.length])

    React.useEffect(() => {
      void props.control<RemoteStatus>('status').then(setStatus).catch(() => undefined)
    }, [])

    React.useEffect(() => {
      if (status?.serverUrl !== undefined) {
        setLoginServerUrl(status.serverUrl)
      }
    }, [status?.serverUrl])

    React.useEffect(() => {
      const remoteActive = status?.mode === 'remote'
      document.documentElement.classList.toggle('dshRemoteTargetActive', remoteActive)
      return () => {
        if (remoteActive) document.documentElement.classList.remove('dshRemoteTargetActive')
      }
    }, [status?.mode])

    const startQrLogin = async (provider: OAuthProvider): Promise<void> => {
      const run = ++qrFlowRun.current
      setBusy(true)
      setError(undefined)
      setQrExpired(false)
      try {
        const session = await props.control<OAuthQrSession>('client.account.qr.start', { provider })
        const image = await QRCode.toDataURL(session.scanUrl, {
          width: 184,
          margin: 1,
          errorCorrectionLevel: 'L',
        })
        if (run !== qrFlowRun.current) return
        setQrSession(session)
        setQrImage(image)
      } catch (reason) {
        if (run === qrFlowRun.current) setError(messageOf(reason))
      } finally {
        if (run === qrFlowRun.current) setBusy(false)
      }
    }

    React.useEffect(() => {
      if (!open || !needsAuthorization || savingServer || serverDirty) return
      let active = true
      const run = ++providerRequestRun.current
      qrFlowRun.current += 1
      setBusy(false)
      setQrSession(undefined)
      setQrImage(undefined)
      setQrExpired(false)
      setOAuthProviders([])
      setProvidersLoading(true)
      setProvidersFailed(false)
      void props.control<OAuthProviderInfo[]>('client.account.providers').then(items => {
        if (!active || run !== providerRequestRun.current) return
        const available = items.filter(item => item.qrStartUrl != null)
        setOAuthProviders(available)
        setLoginMethod(current => {
          if (loginMethodManuallySelected.current && (current === 'password'
            || available.some(item => `oauth:${item.id}` === current))) return current
          const preferred = available.find(item => item.id === props.preferredQrProvider) ?? available[0]
          return preferred === undefined ? 'password' : `oauth:${preferred.id}`
        })
      }).catch(reason => {
        if (!active || run !== providerRequestRun.current) return
        setProvidersFailed(true)
        setLoginMethod('password')
        setError(messageOf(reason))
      }).finally(() => {
        if (active && run === providerRequestRun.current) setProvidersLoading(false)
      })
      return () => { active = false }
    }, [open, needsAuthorization, status?.serverUrl, props.preferredQrProvider, providerReload, savingServer, serverDirty])

    React.useEffect(() => {
      if (!open || !needsAuthorization || savingServer || serverDirty || providersLoading || loginMethod === 'password'
        || !oauthProviders.some(item => `oauth:${item.id}` === loginMethod) || qrSession !== undefined || qrExpired) return
      void startQrLogin(loginMethod.slice(6))
    }, [open, needsAuthorization, providersLoading, oauthProviders, loginMethod, qrSession, qrExpired, savingServer, serverDirty])

    React.useEffect(() => {
      if (!open || savingServer || serverDirty || loginMethod === 'password' || qrSession === undefined) return
      let active = true
      let polling = false
      let settled = false
      const run = qrFlowRun.current
      let timer: number | undefined
      const poll = (): void => {
        if (polling || settled) return
        polling = true
        void props.control<OAuthQrPollResult>('client.account.qr.poll', { qrId: qrSession.qrId }).then(async result => {
          if (!active || settled || run !== qrFlowRun.current) return
          if (result.status === 'complete') {
            settled = true
            if (timer !== undefined) window.clearInterval(timer)
            setBusy(true)
            setError(undefined)
            setQrExpired(false)
            try {
              const [nextDevices, nextStatus] = await Promise.all([
                props.control<RemoteDevice[]>('devices'),
                props.control<RemoteStatus>('status'),
              ])
              if (active && run === qrFlowRun.current) {
                setDevices(nextDevices)
                setStatus(nextStatus)
                setNeedsAuthorization(false)
              }
            } catch (reason) {
              if (active && run === qrFlowRun.current) setError(connectionErrorMessageFor(reason, t))
            } finally {
              if (run === qrFlowRun.current) {
                setQrSession(undefined)
                setQrImage(undefined)
                setBusy(false)
              }
            }
          } else if (result.status === 'expired') {
            settled = true
            if (timer !== undefined) window.clearInterval(timer)
            setQrExpired(true)
            setQrSession(undefined)
            setQrImage(undefined)
          }
        }).catch(reason => {
          if (active && !settled && run === qrFlowRun.current) setError(messageOf(reason))
        }).finally(() => {
          polling = false
        })
      }
      poll()
      timer = window.setInterval(poll, 1_500)
      return () => {
        active = false
        if (timer !== undefined) window.clearInterval(timer)
      }
    }, [open, loginMethod, qrSession, savingServer, serverDirty])

    const selectLoginMethod = (method: LoginMethod): void => {
      loginMethodManuallySelected.current = true
      if (method === loginMethod) return
      qrFlowRun.current += 1
      setLoginMethod(method)
      setQrSession(undefined)
      setQrImage(undefined)
      setQrExpired(false)
      setError(undefined)
    }

    const orderedQrProviders = [...oauthProviders].sort((a, b) =>
      Number(b.id === props.preferredQrProvider) - Number(a.id === props.preferredQrProvider))
    const selectedProvider = oauthProviders.find(item => `oauth:${item.id}` === loginMethod)
    const scanLabel = t('scanWithProvider', { provider: selectedProvider?.displayName ?? '' })

    const qrLoginTab = (provider: OAuthProviderInfo): unknown => React.createElement('button', {
      key: provider.id, type: 'button', role: 'tab', id: `dsh-remote-oauth:${provider.id}-tab`,
      'aria-selected': loginMethod === `oauth:${provider.id}`, 'aria-controls': `dsh-remote-oauth:${provider.id}-panel`,
      className: loginMethod === `oauth:${provider.id}` ? 'isActive' : '', disabled: busy,
      onClick: () => selectLoginMethod(`oauth:${provider.id}`),
    }, t('providerLogin', { provider: provider.displayName }))

    const selectHost = async (host: RemoteDevice): Promise<void> => {
      setBusy(true)
      setError(undefined)
      setConnectingHost(host)
      setCodexWorkspaces([])
      setCursorWorkspaces([])
      setAntigravityWorkspaces([])
      setPiWorkspaces([])
      setOpencodeWorkspaces([])
      setClaudeWorkspaces([])
      setHermesWorkspaces([])
      setShowAllWorkspaces(false)
      setShowAllCodexWorkspaces(false)
      setShowAllCursorWorkspaces(false)
      setShowAllAntigravityWorkspaces(false)
      setShowAllPiWorkspaces(false)
      setShowAllOpencodeWorkspaces(false)
      setShowAllClaudeWorkspaces(false)
      setShowAllHermesWorkspaces(false)
      try {
        const result = await runConnectHostProgress(
          status?.preferredTransports,
          host.deviceId,
          props.control,
          { label: 'remoteProgressLoadingWorkspaces', detail: 'remoteProgressLoadingWorkspacesDetail' },
          setProgress,
          progressRun,
          async () => {
            // The first request establishes the selected Host connection.
            // Keep optional probes on that same connection instead of racing
            // multiple initial handshakes for one target.
            const nextWorkspaces = await props.control<RemoteWorkspaceView[]>('workspaces.list', {
              targetDeviceId: host.deviceId,
            })
            // The selected Host connection is established by workspaces.list.
            // Optional backend catalogs are independent reads; running them
            // together keeps an unavailable or slow ACP backend from delaying
            // CodeX discovery and the picker transition.
            const [nextCodexWorkspaces, nextCursorWorkspaces, nextAntigravityWorkspaces,
              nextPiWorkspaces, nextOpencodeWorkspaces, nextClaudeWorkspaces, nextHermesWorkspaces, nextStatus] = await Promise.all([
              props.control<CodexWorkspaceView[]>('codex.workspaces.list', { targetDeviceId: host.deviceId }).catch(() => []),
              props.control<CursorWorkspaceView[]>('cursor.workspaces.list', { targetDeviceId: host.deviceId }).catch(() => []),
              props.control<CursorWorkspaceView[]>('antigravity.workspaces.list', { targetDeviceId: host.deviceId }).catch(() => []),
              props.control<CursorWorkspaceView[]>('pi.workspaces.list', { targetDeviceId: host.deviceId }).catch(() => []),
              props.control<CursorWorkspaceView[]>('opencode.workspaces.list', { targetDeviceId: host.deviceId }).catch(() => []),
              props.control<CursorWorkspaceView[]>('claude.workspaces.list', { targetDeviceId: host.deviceId }).catch(() => []),
              props.control<CursorWorkspaceView[]>('hermes.workspaces.list', { targetDeviceId: host.deviceId }).catch(() => []),
              props.control<RemoteStatus>('status').catch(() => undefined),
            ])
            if (nextStatus !== undefined) setStatus(nextStatus)
            return {
              workspaces: nextWorkspaces,
              codexWorkspaces: nextCodexWorkspaces,
              cursorWorkspaces: nextCursorWorkspaces,
              antigravityWorkspaces: nextAntigravityWorkspaces,
              piWorkspaces: nextPiWorkspaces,
              opencodeWorkspaces: nextOpencodeWorkspaces,
              claudeWorkspaces: nextClaudeWorkspaces,
              hermesWorkspaces: nextHermesWorkspaces,
              status: nextStatus,
            }
          },
          result => connectedProgress(result.status),
        )
        setWorkspaces(result.workspaces)
        setCodexWorkspaces(result.codexWorkspaces)
        setCursorWorkspaces(result.cursorWorkspaces)
        setAntigravityWorkspaces(result.antigravityWorkspaces)
        setPiWorkspaces(result.piWorkspaces)
        setOpencodeWorkspaces(result.opencodeWorkspaces)
        setClaudeWorkspaces(result.claudeWorkspaces)
        setHermesWorkspaces(result.hermesWorkspaces)
        setWorkspaceBackend('harness')
        setCodexWorkspaceId(undefined)
        setCursorWorkspaceId(undefined)
        setAntigravityWorkspaceId(undefined)
        setPiWorkspaceId(undefined)
        setOpencodeWorkspaceId(undefined)
        setClaudeWorkspaceId(undefined)
        setHermesWorkspaceId(undefined)
        setSelectedHost(host)
        setPath('')
        setAddingWorkspace(false)
        setDirectory(undefined)
      } catch (reason) {
        setError(connectionErrorMessageFor(reason, t))
      } finally {
        // A failed attempt expands the full Host list again; a successful one
        // is represented by `selectedHost`.
        setConnectingHost(undefined)
        setBusy(false)
      }
    }

    const browseDirectory = async (nextPath?: string): Promise<void> => {
      if (selectedHost === undefined) return
      setBusy(true)
      setError(undefined)
      try {
        const listing = await props.control<RemoteDirectoryListing>('directory.list', {
          targetDeviceId: selectedHost.deviceId,
          ...(nextPath === undefined ? {} : { path: nextPath }),
        })
        setDirectory(listing)
        setCodexWorkspaceId(undefined)
        setCursorWorkspaceId(undefined)
        setAntigravityWorkspaceId(undefined)
        setPiWorkspaceId(undefined)
        setOpencodeWorkspaceId(undefined)
        setClaudeWorkspaceId(undefined)
        setHermesWorkspaceId(undefined)
        setPath(listing.path)
      } catch (reason) {
        setError(connectionErrorMessageFor(reason, t))
      } finally {
        setBusy(false)
      }
    }

    const startAddingWorkspace = (backend: 'harness' | 'codex' | 'cursor' | 'antigravity' | 'pi' | 'opencode' | 'claude' | 'hermes'): void => {
      setAddingWorkspace(true)
      setWorkspaceBackend(backend)
      setCodexWorkspaceId(undefined)
      setCursorWorkspaceId(undefined)
      setAntigravityWorkspaceId(undefined)
      setPiWorkspaceId(undefined)
      setOpencodeWorkspaceId(undefined)
      setClaudeWorkspaceId(undefined)
      setHermesWorkspaceId(undefined)
      setShowAllWorkspaces(false)
      setShowAllCodexWorkspaces(false)
      setShowAllCursorWorkspaces(false)
      setShowAllAntigravityWorkspaces(false)
      setShowAllPiWorkspaces(false)
      setShowAllOpencodeWorkspaces(false)
      setShowAllClaudeWorkspaces(false)
      setShowAllHermesWorkspaces(false)
      setDirectory(undefined)
      setPath('')
      void browseDirectory()
    }

    const cancelAddingWorkspace = (): void => {
      setAddingWorkspace(false)
      setWorkspaceBackend('harness')
      setCodexWorkspaceId(undefined)
      setCursorWorkspaceId(undefined)
      setAntigravityWorkspaceId(undefined)
      setPiWorkspaceId(undefined)
      setOpencodeWorkspaceId(undefined)
      setClaudeWorkspaceId(undefined)
      setHermesWorkspaceId(undefined)
      setDirectory(undefined)
      setPath('')
    }

    const refreshRemote = async (): Promise<void> => {
      setBusy(true)
      setNotice(undefined)
      setError(undefined)
      try {
        const nextStatus = await props.control<RemoteStatus>('status')
        setStatus(nextStatus)
        if (nextStatus.controlUnavailable) {
          setNeedsAuthorization(undefined)
          setError(t('remoteControlUnavailable'))
          return
        }
        if (!nextStatus.available) {
          setDevices([])
          setNeedsAuthorization(false)
          setSelectedHost(undefined)
          setWorkspaces([])
          setCodexWorkspaces([])
          setCursorWorkspaces([])
          setAntigravityWorkspaces([])
          setPiWorkspaces([])
          setOpencodeWorkspaces([])
          setClaudeWorkspaces([])
          setHermesWorkspaces([])
          setShowAllWorkspaces(false)
          setShowAllCodexWorkspaces(false)
          setShowAllCursorWorkspaces(false)
          setShowAllAntigravityWorkspaces(false)
          setShowAllPiWorkspaces(false)
          setShowAllOpencodeWorkspaces(false)
          setShowAllClaudeWorkspaces(false)
          setShowAllHermesWorkspaces(false)
          setWorkspaceBackend('harness')
          setCodexWorkspaceId(undefined)
          setCursorWorkspaceId(undefined)
          setAntigravityWorkspaceId(undefined)
          setPiWorkspaceId(undefined)
          setOpencodeWorkspaceId(undefined)
          setClaudeWorkspaceId(undefined)
          setHermesWorkspaceId(undefined)
          setPath('')
          setAddingWorkspace(false)
          setDirectory(undefined)
          return
        }
        try {
          const authorization = await props.control<{ hasCredentials: boolean }>('client.authorization.status')
          if (!authorization.hasCredentials) {
            throw Object.assign(new Error('Remote account authorization is required.'), { code: 'ACCOUNT_AUTH_REQUIRED' })
          }
          const nextDevices = await props.control<RemoteDevice[]>('devices')
          setDevices(nextDevices)
          setNeedsAuthorization(false)
          if (selectedHost !== undefined) {
            const nextSelectedHost = nextDevices.find(device => device.deviceId === selectedHost.deviceId)
            if (nextSelectedHost === undefined) {
              setSelectedHost(undefined)
              setWorkspaces([])
              setCodexWorkspaces([])
              setCursorWorkspaces([])
              setAntigravityWorkspaces([])
              setPiWorkspaces([])
              setOpencodeWorkspaces([])
              setClaudeWorkspaces([])
              setHermesWorkspaces([])
              setShowAllWorkspaces(false)
              setShowAllCodexWorkspaces(false)
              setShowAllCursorWorkspaces(false)
              setShowAllAntigravityWorkspaces(false)
              setShowAllPiWorkspaces(false)
              setShowAllOpencodeWorkspaces(false)
              setShowAllClaudeWorkspaces(false)
              setShowAllHermesWorkspaces(false)
              setWorkspaceBackend('harness')
              setCodexWorkspaceId(undefined)
              setCursorWorkspaceId(undefined)
              setAntigravityWorkspaceId(undefined)
              setPiWorkspaceId(undefined)
              setOpencodeWorkspaceId(undefined)
              setClaudeWorkspaceId(undefined)
              setHermesWorkspaceId(undefined)
              setPath('')
              setAddingWorkspace(false)
              setDirectory(undefined)
            } else {
              setSelectedHost(nextSelectedHost)
              void props.control<RemoteWorkspaceView[]>('workspaces.list', { targetDeviceId: nextSelectedHost.deviceId })
                .then(w => setWorkspaces(w)).catch(() => undefined)
              void props.control<CodexWorkspaceView[]>('codex.workspaces.list', { targetDeviceId: nextSelectedHost.deviceId })
                .then(w => setCodexWorkspaces(w)).catch(() => undefined)
              void props.control<CursorWorkspaceView[]>('cursor.workspaces.list', { targetDeviceId: nextSelectedHost.deviceId })
                .then(w => setCursorWorkspaces(w)).catch(() => undefined)
              void props.control<CursorWorkspaceView[]>('antigravity.workspaces.list', { targetDeviceId: nextSelectedHost.deviceId })
                .then(w => setAntigravityWorkspaces(w)).catch(() => undefined)
              void props.control<CursorWorkspaceView[]>('pi.workspaces.list', { targetDeviceId: nextSelectedHost.deviceId })
                .then(w => setPiWorkspaces(w)).catch(() => undefined)
              void props.control<CursorWorkspaceView[]>('opencode.workspaces.list', { targetDeviceId: nextSelectedHost.deviceId })
                .then(w => setOpencodeWorkspaces(w)).catch(() => undefined)
              void props.control<CursorWorkspaceView[]>('claude.workspaces.list', { targetDeviceId: nextSelectedHost.deviceId })
                .then(w => setClaudeWorkspaces(w)).catch(() => undefined)
              void props.control<CursorWorkspaceView[]>('hermes.workspaces.list', { targetDeviceId: nextSelectedHost.deviceId })
                .then(w => setHermesWorkspaces(w)).catch(() => undefined)
            }
          }
        } catch (reason) {
          // A transient Server outage is not a sign-out. Keep the last known
          // device/session view and only show login for explicit auth failures.
          const code = typeof reason === 'object' && reason !== null && 'code' in reason
            ? String((reason as { code: unknown }).code)
            : ''
          if (['ACCOUNT_AUTH_REQUIRED', 'AUTH_INVALID', 'AUTH_REQUIRED', 'TOKEN_EXPIRED', 'DEVICE_REVOKED', 'DEVICE_OWNERSHIP_REQUIRED'].includes(code)) {
            setDevices([])
            setNeedsAuthorization(true)
            setSelectedHost(undefined)
            setWorkspaces([])
            setCodexWorkspaces([])
            setCursorWorkspaces([])
            setAntigravityWorkspaces([])
            setPiWorkspaces([])
            setOpencodeWorkspaces([])
            setClaudeWorkspaces([])
            setHermesWorkspaces([])
            setShowAllWorkspaces(false)
            setShowAllCodexWorkspaces(false)
            setShowAllCursorWorkspaces(false)
            setShowAllAntigravityWorkspaces(false)
            setShowAllPiWorkspaces(false)
            setShowAllOpencodeWorkspaces(false)
            setShowAllClaudeWorkspaces(false)
            setShowAllHermesWorkspaces(false)
            setWorkspaceBackend('harness')
            setCodexWorkspaceId(undefined)
            setCursorWorkspaceId(undefined)
            setAntigravityWorkspaceId(undefined)
            setPiWorkspaceId(undefined)
            setOpencodeWorkspaceId(undefined)
            setClaudeWorkspaceId(undefined)
            setHermesWorkspaceId(undefined)
            setPath('')
            setAddingWorkspace(false)
            setDirectory(undefined)
          } else {
            setError(messageOf(reason))
          }
        }
      } catch (reason) {
        setError(connectionErrorMessageFor(reason, t))
      } finally {
        setBusy(false)
      }
    }

    const show = async (): Promise<void> => {
      setShowAllWorkspaces(false)
      setShowAllCodexWorkspaces(false)
      setShowAllCursorWorkspaces(false)
      setShowAllAntigravityWorkspaces(false)
      setShowAllPiWorkspaces(false)
      setShowAllOpencodeWorkspaces(false)
      setShowAllClaudeWorkspaces(false)
      setShowAllHermesWorkspaces(false)
      setOpen(true)
      await refreshRemote()
    }

    React.useEffect(() => props.subscribeOpen(() => { void show() }), [props.subscribeOpen, show])

    React.useEffect(() => {
      // The pushed status drives the sidebar entry (update badge, remote mode)
      // and the open modal alike; the subscription replays the latest status
      // immediately, so the entry reflects the startup registry check without
      // waiting for the modal to be opened.
      return props.statusFeed.subscribe(setStatus)
    }, [props.statusFeed])

    const chooseAnotherHost = (): void => {
      setSelectedHost(undefined)
      setWorkspaces([])
      setCodexWorkspaces([])
      setCursorWorkspaces([])
      setAntigravityWorkspaces([])
      setPiWorkspaces([])
      setOpencodeWorkspaces([])
      setClaudeWorkspaces([])
      setHermesWorkspaces([])
      setShowAllWorkspaces(false)
      setShowAllCodexWorkspaces(false)
      setShowAllCursorWorkspaces(false)
      setShowAllAntigravityWorkspaces(false)
      setShowAllPiWorkspaces(false)
      setShowAllOpencodeWorkspaces(false)
      setShowAllClaudeWorkspaces(false)
      setShowAllHermesWorkspaces(false)
      setWorkspaceBackend('harness')
      setCodexWorkspaceId(undefined)
      setCursorWorkspaceId(undefined)
      setAntigravityWorkspaceId(undefined)
      setPiWorkspaceId(undefined)
      setOpencodeWorkspaceId(undefined)
      setClaudeWorkspaceId(undefined)
      setHermesWorkspaceId(undefined)
      setDirectory(undefined)
      setPath('')
      setAddingWorkspace(false)
      setError(undefined)
    }

    const resetLoginFlow = (): void => {
      providerRequestRun.current += 1
      qrFlowRun.current += 1
      setQrSession(undefined)
      setQrImage(undefined)
      setQrExpired(false)
      setOAuthProviders([])
      setProvidersFailed(false)
      setProvidersLoading(false)
      setLoginMethod('password')
      loginMethodManuallySelected.current = false
      setPassword('')
      setError(undefined)
      setNotice(undefined)
    }

    const saveLoginServer = async (): Promise<void> => {
      if (loginServerUrl.trim() === '' || savingServer) return
      resetLoginFlow()
      setSavingServer(true)
      setBusy(true)
      try {
        const view = await props.control<PluginSettingsView>('settings.server.set', { serverUrl: loginServerUrl.trim() })
        if (view.applies !== 'live') {
          setNotice(t('serverSaved'))
          return
        }
        const nextStatus = await props.control<RemoteStatus>('status')
        setStatus(nextStatus)
        setLoginServerUrl(nextStatus.serverUrl ?? loginServerUrl.trim())
        setEditingServer(false)
        setProviderReload(value => value + 1)
      } catch (reason) {
        setError(messageOf(reason))
      } finally {
        setSavingServer(false)
        setBusy(false)
      }
    }

    const signInClient = async (): Promise<void> => {
      if (serverDirty || savingServer || email.trim() === '' || password === '' || loginServerUrl.trim() === '') return
      setBusy(true)
      setError(undefined)
      try {
        await props.control('settings.configure', {
          role: 'client',
          serverUrl: loginServerUrl.trim(),
          email: email.trim(),
          password,
        })
        setDevices(await props.control<RemoteDevice[]>('devices'))
        setStatus(await props.control<RemoteStatus>('status'))
        setNeedsAuthorization(false)
        setPassword('')
      } catch (reason) {
        setError(connectionErrorMessageFor(reason, t))
      } finally {
        setBusy(false)
      }
    }

    const authorizeHost = async (kind: 'account' | 'code'): Promise<void> => {
      if (kind === 'account' && (hostEmail.trim() === '' || hostPassword === '')) return
      if (kind === 'code' && hostRegistrationCode.trim() === '') return
      setBusy(true)
      setError(undefined)
      try {
        if (kind === 'account') {
          await props.control('host.account.login', { email: hostEmail.trim(), password: hostPassword })
          setHostPassword('')
        } else {
          await props.control('host.registration-code.submit', { code: hostRegistrationCode.trim() })
          setHostRegistrationCode('')
        }
        setStatus(await props.control<RemoteStatus>('status'))
      } catch (reason) {
        setError(connectionErrorMessageFor(reason, t))
      } finally {
        setBusy(false)
      }
    }

    const openLocalWorkspaces = async (): Promise<void> => {
      setBusy(true)
      setError(undefined)
      try {
        await props.control('mode.set', { mode: 'local' })
        window.location.reload()
      } catch (reason) {
        setError(messageOf(reason))
        setBusy(false)
      }
    }

    const setCurrentDeviceControl = async (enabled: boolean): Promise<void> => {
      setBusy(true)
      setError(undefined)
      try {
        setStatus(await props.control<RemoteStatus>('host.authorization.set', { enabled }))
      } catch (reason) {
        setError(messageOf(reason))
      } finally {
        setBusy(false)
      }
    }

    const logoutRemote = async (): Promise<void> => {
      qrFlowRun.current += 1
      progressRun.current += 1
      setBusy(true)
      setError(undefined)
      try {
        await props.control('settings.logout')
        setDevices([])
        setSelectedHost(undefined)
        setConnectingHost(undefined)
        setWorkspaces([])
        setCodexWorkspaces([])
        setCursorWorkspaces([])
        setAntigravityWorkspaces([])
        setPiWorkspaces([])
        setOpencodeWorkspaces([])
        setClaudeWorkspaces([])
        setHermesWorkspaces([])
        setDirectory(undefined)
        setPath('')
        setPassword('')
        setProgress(undefined)
        setNeedsAuthorization(true)
        setQrSession(undefined)
        setQrImage(undefined)
        setQrExpired(false)
        setStatus(await props.control<RemoteStatus>('status'))
      } catch (reason) {
        setError(messageOf(reason))
      } finally {
        setBusy(false)
      }
    }

    const openWorkspace = async (selection?:
      | { backend: 'harness'; path: string }
      | { backend: 'codex'; path: string; workspaceId: string }
      | { backend: 'cursor'; path: string; workspaceId?: string }
      | { backend: 'antigravity'; path: string; workspaceId?: string }
      | { backend: 'pi'; path: string; workspaceId?: string }
      | { backend: 'opencode'; path: string; workspaceId?: string }
      | { backend: 'claude'; path: string; workspaceId?: string }
      | { backend: 'hermes'; path: string; workspaceId?: string }): Promise<void> => {
      const targetBackend = selection?.backend ?? workspaceBackend
      const targetPath = (selection?.path ?? path).trim()
      const targetCodexWorkspaceId = selection?.backend === 'codex'
        ? selection.workspaceId
        : selection === undefined ? codexWorkspaceId : undefined
      const targetCursorWorkspaceId = selection?.backend === 'cursor'
        ? selection.workspaceId
        : selection === undefined ? cursorWorkspaceId : undefined
      const targetAntigravityWorkspaceId = selection?.backend === 'antigravity'
        ? selection.workspaceId
        : selection === undefined ? antigravityWorkspaceId : undefined
      const targetPiWorkspaceId = selection?.backend === 'pi'
        ? selection.workspaceId
        : selection === undefined ? piWorkspaceId : undefined
      const targetOpencodeWorkspaceId = selection?.backend === 'opencode'
        ? selection.workspaceId
        : selection === undefined ? opencodeWorkspaceId : undefined
      const targetClaudeWorkspaceId = selection?.backend === 'claude'
        ? selection.workspaceId
        : selection === undefined ? claudeWorkspaceId : undefined
      const targetHermesWorkspaceId = selection?.backend === 'hermes'
        ? selection.workspaceId
        : selection === undefined ? hermesWorkspaceId : undefined
      const createWorkspace = selection === undefined && addingWorkspace
      if (selectedHost === undefined
        || targetPath === ''
        || !createWorkspace && targetBackend === 'codex' && targetCodexWorkspaceId === undefined
        || !createWorkspace && targetBackend === 'cursor' && targetCursorWorkspaceId === undefined && targetPath === ''
        || !createWorkspace && targetBackend === 'antigravity' && targetAntigravityWorkspaceId === undefined && targetPath === '') return
      setBusy(true)
      setError(undefined)
      try {
        const nextStatus = await (targetBackend === 'codex'
          ? createWorkspace
            ? props.control<RemoteStatus>('codex.workspace.create', {
              targetDeviceId: selectedHost.deviceId,
              path: targetPath,
            })
            : props.control<RemoteStatus>('codex.workspace.open', {
              targetDeviceId: selectedHost.deviceId,
              workspaceId: targetCodexWorkspaceId,
            })
          : targetBackend !== 'harness'
            ? (() => {
              const workspaceId = { cursor: targetCursorWorkspaceId, antigravity: targetAntigravityWorkspaceId,
                pi: targetPiWorkspaceId, opencode: targetOpencodeWorkspaceId, claude: targetClaudeWorkspaceId,
                hermes: targetHermesWorkspaceId }[targetBackend]
              return createWorkspace || workspaceId === undefined
                ? props.control<RemoteStatus>(`${targetBackend}.workspace.create`, { targetDeviceId: selectedHost.deviceId, path: targetPath })
                : props.control<RemoteStatus>(`${targetBackend}.workspace.open`, { targetDeviceId: selectedHost.deviceId, workspaceId })
            })()
                  : props.control<RemoteStatus>('workspace.open', {
                    targetDeviceId: selectedHost.deviceId,
                    path: targetPath,
                  }))
        setStatus(nextStatus)
        if (nextStatus.workspaceSelection !== undefined) {
          window.sessionStorage.setItem(pendingWorkspaceSelectionKey, JSON.stringify(nextStatus.workspaceSelection))
        }
        window.location.reload()
      } catch (reason) {
        setError(messageOf(reason))
        setBusy(false)
      }
    }

    const remoteLabel = status?.mode === 'remote'
      ? t('activeRemote', { name: status.target?.name ?? t('host') })
      : t('remoteEntry')
    const remoteActionLabel = status?.mode === 'remote'
      ? `${remoteLabel} · ${t('exitRemote')}`
      : remoteLabel
    const visibleWorkspaces = showAllWorkspaces ? workspaces : workspaces.slice(0, 3)
    const visibleCodexWorkspaces = showAllCodexWorkspaces ? codexWorkspaces : codexWorkspaces.slice(0, 3)
    const visibleCursorWorkspaces = showAllCursorWorkspaces ? cursorWorkspaces : cursorWorkspaces.slice(0, 3)
    const visibleAntigravityWorkspaces = showAllAntigravityWorkspaces ? antigravityWorkspaces : antigravityWorkspaces.slice(0, 3)
    const visiblePiWorkspaces = showAllPiWorkspaces ? piWorkspaces : piWorkspaces.slice(0, 3)
    const visibleOpencodeWorkspaces = showAllOpencodeWorkspaces ? opencodeWorkspaces : opencodeWorkspaces.slice(0, 3)
    const visibleClaudeWorkspaces = showAllClaudeWorkspaces ? claudeWorkspaces : claudeWorkspaces.slice(0, 3)
    const visibleHermesWorkspaces = showAllHermesWorkspaces ? hermesWorkspaces : hermesWorkspaces.slice(0, 3)
    // Runtime features already validate both negotiated capabilities and
    // workspace readiness, including the existing CodeX legacy fallback.
    const codexAvailable = status?.remoteFeatures?.codex === true
    const cursorAvailable = status?.remoteFeatures?.cursor === true
    const antigravityAvailable = status?.remoteFeatures?.antigravity === true
    const piAvailable = status?.remoteFeatures?.pi === true
    const opencodeAvailable = status?.remoteFeatures?.opencode === true
    const claudeAvailable = status?.remoteFeatures?.claude === true
    const hermesAvailable = status?.remoteFeatures?.hermes === true
    const updateInfo = status?.update
    const localUpdateAvailable = updateInfo !== undefined
      && compareVersions(updateInfo.currentVersion, updateInfo.latestVersion) < 0
    const updateNotice = updateInfo !== undefined && localUpdateAvailable
      ? t('updateAvailable', { latest: updateInfo.latestVersion, current: updateInfo.currentVersion })
      : undefined
    const deviceUpdateAvailable = (device: RemoteDevice): boolean =>
      updateInfo !== undefined
      && device.clientVersion !== undefined
      && compareVersions(device.clientVersion, updateInfo.latestVersion) < 0
    const selectedHostDetails = selectedHost === undefined ? undefined : [
      formatPlatform(selectedHost.platform),
      selectedHost.harnessVersion === undefined ? undefined : t('harnessVersion', { version: selectedHost.harnessVersion }),
      selectedHost.clientVersion === undefined ? undefined : t('pluginVersion', { version: selectedHost.clientVersion }),
      deviceUpdateAvailable(selectedHost) ? t('updateAvailableTag') : undefined,
    ].filter(Boolean).join(' · ')
    const connectedClients = status?.host?.connectedClients ?? []
    const connectedCount = connectedClients.length
    const connectedCountLabel = t('connectedClientCount', { count: connectedCount })
    const connectedMenu = !needsAuthorization && status?.hostAuthorizationAvailable === true
      ? React.createElement('div', {
        className: `dshRemoteConnectedMenu${devicesOpen ? ' isOpen' : ''}`,
      },
        React.createElement('a', {
          href: connectedCount > 0 ? '#connected-devices' : undefined,
          className: `dshRemoteConnectedCount${connectedCount > 0 ? ' isOnline isInteractive' : ''}`,
          'aria-expanded': connectedCount > 0 ? devicesOpen : undefined,
          'aria-haspopup': connectedCount > 0 ? 'dialog' : undefined,
          title: connectedCountLabel,
          'aria-label': connectedCountLabel,
          onClick: (event: Event) => {
            event.preventDefault()
            if (connectedCount === 0) return
            setDevicesOpen(current => !current)
          },
        }, connectedCountLabel),
        devicesOpen && connectedCount > 0
          ? React.createElement('div', {
            className: 'dshRemoteConnectedPanel',
            id: 'connected-devices',
            role: 'dialog',
            'aria-label': t('currentConnectedDevices'),
          },
            React.createElement('strong', { className: 'dshRemoteConnectedPanelTitle' }, t('currentConnectedDevices')),
            React.createElement(
              'div',
              { className: 'dshRemoteClientList', 'aria-label': t('currentConnectedDevices') },
              ...connectedClients.map(client => React.createElement('div', {
                key: client.deviceId,
                className: 'dshRemoteClientRow',
              },
                React.createElement('span', null,
                  React.createElement('strong', null, client.name.trim() === '' ? t('unknownDevice') : client.name),
                  React.createElement('small', null, [
                    client.platform === undefined ? undefined : formatPlatform(client.platform),
                    connectedClientModeLabel(client.mode, t),
                  ].filter(Boolean).join(' · '))),
                React.createElement('small', { className: 'dshRemoteClientOnline' }, t('connected')))),
            ))
          : null)
      : null

    // While a Host is connecting only that row stays listed, so the progress
    // panel below the list is visible without scrolling past every device.
    const listedHosts = connectingHost === undefined ? devices : [connectingHost]

    const computerIcon = React.createElement('svg', {
      className: 'dshRemoteComputerIcon',
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 1.7,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      'aria-hidden': true,
    },
      React.createElement('rect', { x: 3, y: 4, width: 18, height: 13, rx: 2 }),
      React.createElement('path', { d: 'M8 21h8M12 17v4' }))
    const remoteActive = status?.mode === 'remote'
    // Wide entry: the button stretches full width and carries the update suffix
    // in the host's own update-indicator look. Rail/Compact entries are
    // icon-only, so they get the official 6px brand dot instead.
    const updateSuffix = localUpdateAvailable && props.wide
      ? React.createElement('span', {
        className: 'dshRemoteUpdateSuffix',
        title: updateNotice, 'aria-hidden': true,
      }, t('updateShort', { version: updateInfo?.latestVersion ?? '' }))
      : null
    const updateDot = localUpdateAvailable
      ? React.createElement('span', { className: 'dshRemoteUpdateDot', title: t('updateBadge'), 'aria-hidden': true })
      : null
    const entry = React.createElement('div', { className: `dshRemoteSidebarEntry${remoteActive ? ' isActive' : ''}${props.wide ? ' isWide' : ' isRail'}${localUpdateAvailable ? ' hasUpdate' : ''}` },
      React.createElement(remoteActive && props.wide ? 'div' : 'button', {
        ...(remoteActive && props.wide ? {} : {
          type: 'button',
          disabled: remoteActive && busy,
          onClick: () => void (remoteActive ? openLocalWorkspaces() : show()),
        }),
        className: 'dshRemoteModeButton',
        title: props.wide ? remoteLabel : remoteActionLabel,
        'aria-label': props.wide ? remoteLabel : remoteActionLabel,
      }, computerIcon, props.wide
        ? React.createElement('span', { className: 'dshRemoteSidebarLabel' }, remoteLabel)
        : null, props.wide ? updateSuffix : updateDot),
      remoteActive && props.wide ? React.createElement('button', {
        type: 'button',
        className: 'dshRemoteExitLink',
        disabled: busy,
        onClick: () => void openLocalWorkspaces(),
      }, t('exitRemote')) : null)
    // The Compact style drops the label and lives in the account row, so it is
    // always a plain icon button regardless of the current Remote mode.
    const accountEntry = React.createElement('div', { className: `dshRemoteAccountEntry${remoteActive ? ' isActive' : ''}` },
      React.createElement('button', {
        type: 'button',
        className: 'dshRemoteAccountEntryButton',
        disabled: remoteActive && busy,
        title: remoteActionLabel,
        'aria-label': remoteActionLabel,
        onClick: () => void (remoteActive ? openLocalWorkspaces() : show()),
      }, computerIcon, updateDot))
    const compact = sidebarEntry === 'compact' && props.wide && props.portal !== undefined

    return React.createElement(React.Fragment, null,
      compact
        ? React.createElement(RemoteAccountEntry, { portal: props.portal, fallback: entry }, accountEntry)
        : entry,
      !open ? null : renderBodyPortal(portal, React.createElement('div', {
        className: 'dshRemoteBackdrop',
        role: 'presentation',
        onMouseDown: (event: MouseEvent) => { if (event.target === event.currentTarget) setOpen(false) },
      }, React.createElement('section', {
        className: `dshRemotePage${selectedHost === undefined ? '' : ' hasSelectedHost'}`,
        role: 'dialog',
        'aria-modal': true,
        'aria-label': selectedHost?.name ?? t('remoteTitle'),
        tabIndex: -1,
        ref: pageRef,
      },
        React.createElement('header', { className: 'dshRemotePageHeader' },
          React.createElement('div', { className: 'dshRemotePageIntro' },
            React.createElement('div', { className: 'dshRemotePageTitleRow' },
              React.createElement('strong', null, selectedHost?.name ?? t('remoteTitle')),
              selectedHost === undefined ? React.createElement('a', {
                className: 'dshRemoteStarLink',
                href: 'https://github.com/liguobao/ds-harness-remote',
                target: '_blank',
                rel: 'noreferrer',
              }, t('starProject')) : null),
            React.createElement('p', null, selectedHostDetails ?? t('remoteDescription'))),
          React.createElement('div', { className: 'dshRemotePageActions' },
            selectedHost === undefined ? null : React.createElement('button', {
              type: 'button',
              className: 'dshRemotePageBack',
              disabled: busy,
              title: t('backToHosts'),
              onClick: chooseAnotherHost,
            }, t('backToHosts')),
            React.createElement('button', {
              type: 'button',
              className: 'dshRemotePageRefresh',
              disabled: busy,
              title: t('refreshRemote'),
              'aria-label': t('refreshRemote'),
              onClick: () => void refreshRemote(),
            }, t('refreshRemoteShort')),
            React.createElement('button', { type: 'button', className: 'dshRemotePageClose', onClick: () => setOpen(false), 'aria-label': t('close') }, '×'))),
        React.createElement('main', { className: 'dshRemotePageBody' },
          status?.mode === 'remote' ? React.createElement('button', {
            type: 'button',
            className: 'dshRemoteLocalLink',
            disabled: busy,
            onClick: () => void openLocalWorkspaces(),
          }, t('openLocalWorkspaces')) : null,
          React.createElement(React.Fragment, null,
            needsAuthorization === undefined && busy
              ? React.createElement('p', null, t('checkingConnection')) : null,
            needsAuthorization ? React.createElement('section', { className: 'dshRemoteEnable' },
              React.createElement('div', { className: 'dshRemoteLoginHeading' },
                React.createElement('a', {
                  href: 'https://github.com/liguobao/ds-harness-remote',
                  target: '_blank', rel: 'noopener noreferrer',
                },
                  React.createElement('strong', { className: 'dshRemoteLoginTitle' }, t('signInClient')),
                  React.createElement('span', null, t('signInClientDescription')))),
              React.createElement('div', { className: 'dshRemoteLoginTabs', role: 'tablist' },
                ...orderedQrProviders.map(qrLoginTab),
                React.createElement('button', {
                  type: 'button', role: 'tab', id: 'dsh-remote-password-tab',
                  'aria-selected': loginMethod === 'password', 'aria-controls': 'dsh-remote-password-panel',
                  className: loginMethod === 'password' ? 'isActive' : '', disabled: busy || savingServer || serverDirty,
                  onClick: () => selectLoginMethod('password'),
                }, t('accountPasswordLogin'))),
              providersLoading ? React.createElement('p', { role: 'status' }, t('loadingLoginProviders')) : null,
              providersFailed ? React.createElement('button', {
                type: 'button', disabled: busy || savingServer || serverDirty,
                onClick: () => { setError(undefined); setProviderReload(value => value + 1) },
              }, t('retryLoginProviders')) : null,
              !savingServer && !serverDirty && !providersLoading && !providersFailed && oauthProviders.length === 0
                ? React.createElement('p', { role: 'status' }, t('noLoginProviders')) : null,
              loginMethod !== 'password' && selectedProvider !== undefined
                ? React.createElement('div', {
                  className: 'dshRemoteQrLogin', role: 'tabpanel', id: `dsh-remote-${loginMethod}-panel`,
                  'aria-labelledby': `dsh-remote-${loginMethod}-tab`,
                },
                  qrImage === undefined
                    ? React.createElement('div', { className: 'dshRemoteQrPlaceholder', 'aria-busy': busy },
                      qrExpired ? React.createElement('p', null, t('qrLoginExpired')) : React.createElement('span', null, t('checkingConnection')))
                    : qrSession !== undefined
                      ? React.createElement('a', {
                        className: 'dshRemoteQrOpen', href: qrSession.scanUrl,
                        target: '_blank', rel: 'noopener noreferrer',
                        'aria-label': t('openInBrowser'),
                      },
                        React.createElement('img', {
                          src: qrImage, width: 184, height: 184,
                          alt: scanLabel,
                        }),
                        React.createElement('span', null, t('openInBrowser'), ' ↗'))
                      : null,
                  React.createElement('strong', null, scanLabel),
                  React.createElement('p', null, t('scanLoginHint')),
                  qrExpired ? React.createElement('button', {
                    type: 'button', disabled: busy, onClick: () => setQrExpired(false),
                  }, t('refreshQrCode')) : null)
                : React.createElement('div', {
                  className: 'dshRemoteClientLogin', role: 'tabpanel', id: 'dsh-remote-password-panel',
                  'aria-labelledby': 'dsh-remote-password-tab',
                },
                  React.createElement('input', {
                    type: 'email', value: email, disabled: busy, autoComplete: 'username', placeholder: t('account'),
                    'aria-label': t('account'), onChange: (event: Event) => setEmail((event.target as HTMLInputElement).value),
                  }),
                  React.createElement('input', {
                    type: 'password', value: password, disabled: busy, autoComplete: 'current-password', placeholder: t('password'),
                    'aria-label': t('password'), onChange: (event: Event) => setPassword((event.target as HTMLInputElement).value),
                  }),
                  React.createElement('button', { type: 'button', disabled: busy || savingServer || serverDirty || loginServerUrl.trim() === '' || email.trim() === '' || password === '', onClick: () => void signInClient() }, t(busy ? 'signingIn' : 'startSignIn'))),
              React.createElement('div', { className: 'dshRemoteServiceAddress' },
                React.createElement('span', null, t('currentServiceAddress')),
                editingServer
                  ? React.createElement('form', {
                    className: 'dshRemoteLoginServer',
                    onSubmit: (event: Event) => { event.preventDefault(); void saveLoginServer() },
                  },
                    React.createElement('input', {
                      id: 'dsh-remote-login-server', type: 'url', required: true,
                      'aria-label': t('serverUrl'), value: loginServerUrl,
                      disabled: busy || savingServer, autoComplete: 'url',
                      placeholder: t('serverUrl'), onChange: (event: Event) => {
                        resetLoginFlow()
                        setLoginServerUrl((event.target as HTMLInputElement).value)
                      },
                    }),
                    React.createElement('button', {
                      type: 'submit', disabled: busy || savingServer || loginServerUrl.trim() === '',
                    }, t(savingServer ? 'saving' : 'save')),
                    React.createElement('button', {
                      type: 'button', disabled: busy || savingServer,
                      onClick: () => {
                        setLoginServerUrl(status?.serverUrl ?? 'https://dsh.r2049.cn')
                        setEditingServer(false)
                      },
                    }, t('cancelServiceAddressEdit')))
                  : React.createElement(React.Fragment, null,
                    React.createElement('a', {
                      href: status?.serverUrl ?? loginServerUrl, target: '_blank', rel: 'noreferrer',
                    }, status?.serverUrl ?? loginServerUrl),
                    React.createElement('button', {
                      type: 'button', className: 'dshRemoteServiceAddressEdit',
                      disabled: busy || savingServer,
                      title: t('editServiceAddress'), 'aria-label': t('editServiceAddress'),
                      onClick: () => setEditingServer(true),
                    }, React.createElement('svg', {
                      viewBox: '0 0 24 24', width: 16, height: 16, fill: 'none',
                      stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round',
                      'aria-hidden': true,
                    }, React.createElement('path', { d: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4L16.5 3.5Z' })))))) : null,
            needsAuthorization !== false ? null : React.createElement(React.Fragment, null,
              selectedHost === undefined ? React.createElement('section', { className: 'dshRemoteHosts', 'aria-label': t('chooseHost') },
                status?.hostAuthorizationAvailable && status.host?.accountRequired
                  ? React.createElement('section', { className: 'dshRemoteHostAccount' },
                    React.createElement('strong', null, t('thisMachineHost')),
                    React.createElement('p', null, t('hostSignInHint')),
                    React.createElement('div', { className: 'dshRemoteLogin' },
                      React.createElement('input', { type: 'email', value: hostEmail, disabled: busy, autoComplete: 'username', placeholder: t('serverAccountEmail'), 'aria-label': t('serverAccountEmail'), onChange: (event: Event) => setHostEmail((event.target as HTMLInputElement).value) }),
                      React.createElement('input', { type: 'password', value: hostPassword, disabled: busy, autoComplete: 'current-password', placeholder: t('serverAccountPassword'), 'aria-label': t('serverAccountPassword'), onChange: (event: Event) => setHostPassword((event.target as HTMLInputElement).value) }),
                      React.createElement('button', { type: 'button', disabled: busy || hostEmail.trim() === '' || hostPassword === '', onClick: () => void authorizeHost('account') }, t(busy ? 'signingIn' : 'signInRegisterHost')),
                      React.createElement('input', { value: hostRegistrationCode, disabled: busy, autoComplete: 'one-time-code', placeholder: t('hostRegistrationCode'), 'aria-label': t('hostRegistrationCode'), onChange: (event: Event) => setHostRegistrationCode((event.target as HTMLInputElement).value) }),
                      React.createElement('button', { type: 'button', disabled: busy || hostRegistrationCode.trim() === '', onClick: () => void authorizeHost('code') }, t(busy ? 'registering' : 'useRegistrationCode'))))
                  : null,
                React.createElement('div', { className: 'dshRemoteSectionHeading' },
                  React.createElement('div', { className: 'dshRemoteSectionTitle' },
                    React.createElement('strong', null, t('chooseHost')),
                    status?.hostAuthorizationAvailable ? React.createElement('div', { className: 'dshRemoteHostControlToggle' },
                      React.createElement('span', null, t('allowControlDevice')),
                      React.createElement('input', {
                        type: 'checkbox', role: 'switch', disabled: busy,
                        'aria-label': t('allowControlDevice'),
                        checked: status.host?.authorized === true,
                        onChange: (event: Event) => void setCurrentDeviceControl((event.target as HTMLInputElement).checked),
                      })) : null,
                    connectedMenu)),
                React.createElement('div', {
                  className: `dshRemoteHostList${connectingHost === undefined ? '' : ' isCollapsed'}`,
                  'aria-busy': connectingHost === undefined ? undefined : true,
                }, listedHosts.length === 0
                  ? (error !== undefined ? null : React.createElement('p', null, busy ? t('checkingConnection') : t('noRemoteHosts')))
                  : listedHosts.map(device => React.createElement('button', {
                    type: 'button',
                    key: device.deviceId,
                    disabled: busy || !device.online,
                    'aria-current': connectingHost?.deviceId === device.deviceId ? 'true' : undefined,
                    onClick: () => void selectHost(device),
                  }, React.createElement('span', null,
                    React.createElement('strong', null, device.name),
                    React.createElement('small', null, [
                      formatPlatform(device.platform),
                      device.harnessVersion === undefined ? undefined : t('harnessVersion', { version: device.harnessVersion }),
                      device.clientVersion === undefined ? undefined : t('pluginVersion', { version: device.clientVersion }),
                      deviceUpdateAvailable(device) ? t('updateAvailableTag') : undefined,
                    ].filter(Boolean).join(' · '))),
                    React.createElement('small', null, t(device.online ? 'online' : 'offline')))))) : null,
              React.createElement(RemoteProgressView, { progress, t }),
              selectedHost === undefined
                ? (connectingHost === undefined ? React.createElement(React.Fragment, null,
                  React.createElement('p', { className: 'dshRemoteHint' }, t('selectHostHint')),
                  React.createElement('footer', { className: 'dshRemoteAccountFooter' },
                    React.createElement('span', null, status?.target?.name ?? status?.deviceName ?? status?.host?.account ?? t('account')),
                    updateNotice === undefined ? null : React.createElement('a', {
                      className: 'dshRemoteAccountUpdate',
                      href: 'https://github.com/liguobao/ds-harness-remote/releases',
                      target: '_blank',
                      rel: 'noreferrer',
                      title: updateNotice,
                    }, t('updateAvailableShort', { version: updateInfo?.latestVersion ?? '' })),
                    props.openSettings === undefined ? null : React.createElement('button', {
                      type: 'button', className: 'dshRemoteAccountSettings',
                      onClick: props.openSettings,
                      'aria-label': t('settings'), title: t('settings'),
                    }, t('settings')),
                    React.createElement('button', {
                      type: 'button', className: 'dshRemoteAccountExit', disabled: busy,
                      onClick: () => void logoutRemote(),
                    }, t('exitRemoteAccount')))) : null)
                : React.createElement('section', { className: 'dshRemoteBrowser', 'aria-label': t('chooseDirectory') },
                  React.createElement('div', { className: 'dshRemoteSectionHeading dshRemoteWorkspaceHeading' },
                    React.createElement('strong', null, t(addingWorkspace
                      ? workspaceBackend === 'codex'
                        ? 'addCodexWorkspace'
                        : workspaceBackend === 'cursor'
                          ? 'addCursorWorkspace'
                          : workspaceBackend === 'antigravity'
                            ? 'addAntigravityWorkspace'
                            : workspaceBackend === 'pi'
                              ? 'addPiWorkspace'
                              : workspaceBackend === 'claude' ? 'addClaudeWorkspace' : workspaceBackend === 'hermes' ? 'addHermesWorkspace'
                              : workspaceBackend === 'opencode'
                                ? 'addOpencodeWorkspace'
                                : 'addRemoteWorkspace'
                      : 'existingWorkspaces')),
                    addingWorkspace
                      ? React.createElement('button', {
                        type: 'button',
                        className: 'dshRemoteCancelWorkspace',
                        disabled: busy,
                        onClick: cancelAddingWorkspace,
                      }, t('cancelAddWorkspace'))
                      : React.createElement('button', {
                        type: 'button',
                        className: 'dshRemoteAddWorkspace',
                        disabled: busy,
                        title: t('addRemoteWorkspace'),
                        'aria-label': t('addRemoteWorkspace'),
                        onClick: () => startAddingWorkspace('harness'),
                      }, React.createElement('svg', {
                        className: 'dshRemoteAddWorkspaceIcon', viewBox: '0 0 16 16', 'aria-hidden': true, focusable: false,
                      }, React.createElement('path', { d: 'M8 3v10M3 8h10', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' })))),
                  addingWorkspace
                    ? React.createElement('div', { className: 'dshRemoteFolderBrowser' },
                      directory === undefined
                        ? React.createElement('p', null, t('loadingDirectory'))
                        : React.createElement(React.Fragment, null,
                          React.createElement('nav', { className: 'dshRemoteCrumbs', 'aria-label': t('currentDirectory') },
                            directory.crumbs.map(crumb => React.createElement('button', {
                              type: 'button', key: crumb.path, disabled: busy || crumb.path === directory.path,
                              onClick: () => void browseDirectory(crumb.path),
                            }, crumb.path === directory.home ? '⌂' : crumb.name))),
                          React.createElement('div', { className: 'dshRemoteFolderList' }, directory.entries.filter(entry => !entry.hidden).length === 0
                            ? React.createElement('p', null, t('emptyDirectory'))
                            : directory.entries.filter(entry => !entry.hidden).map(entry => React.createElement('button', {
                              type: 'button', key: entry.path, disabled: busy, onClick: () => void browseDirectory(entry.path),
                            }, React.createElement('span', { 'aria-hidden': true }, '▱'), React.createElement('span', null, entry.name)))),
                          directory.truncated ? React.createElement('small', null, t('directoryTruncated')) : null))
                    : React.createElement('div', { className: 'dshRemoteWorkspaceLists' },
                      React.createElement(React.Fragment, null,
                        React.createElement('div', { id: workspaceListId, className: 'dshRemoteDirectoryList' }, workspaces.length === 0
                          ? React.createElement('p', null, t('noRemoteWorkspaces'))
                          : visibleWorkspaces.map(workspace => React.createElement('button', {
                            type: 'button', key: workspace.workspaceId, disabled: busy,
                            className: workspaceBackend === 'harness' && path === workspace.path ? 'isSelected' : '',
                            'aria-pressed': workspaceBackend === 'harness' && path === workspace.path,
                            onClick: () => { setWorkspaceBackend('harness'); setCodexWorkspaceId(undefined); setCursorWorkspaceId(undefined); setPath(workspace.path) },
                            onDoubleClick: () => void openWorkspace({ backend: 'harness', path: workspace.path }),
                          }, React.createElement('img', { className: 'dshRemoteWorkspaceIcon', src: deepSeekWorkspaceIcon, alt: '', 'aria-hidden': true }),
                            React.createElement('span', null, workspace.title), React.createElement('small', null, workspace.path))),
                          workspaces.length <= 3 || showAllWorkspaces ? null : React.createElement('button', {
                            type: 'button',
                            className: 'dshRemoteWorkspaceMore',
                            disabled: busy,
                            'aria-controls': workspaceListId,
                            'aria-label': t('showAllWorkspaces'),
                            onClick: () => setShowAllWorkspaces(true),
                          }, React.createElement('span', { 'aria-hidden': true }, '…')))),
                      !codexAvailable ? null : React.createElement('section', { className: 'dshRemoteCodexWorkspaceGroup' },
                        React.createElement('div', {
                          id: codexWorkspaceHeadingId,
                          className: 'dshRemoteWorkspaceSourceHeading',
                        }, React.createElement('span', { className: 'dshRemoteWorkspaceSourceText' },
                          React.createElement('strong', null, t('codexVirtualWorkspace'))),
                          !codexAvailable ? null : React.createElement('button', {
                            type: 'button',
                            className: 'dshRemoteAddWorkspace',
                            disabled: busy,
                            title: t('addCodexWorkspace'),
                            'aria-label': t('addCodexWorkspace'),
                            onClick: () => startAddingWorkspace('codex'),
                          }, React.createElement('svg', {
                            className: 'dshRemoteAddWorkspaceIcon', viewBox: '0 0 16 16', 'aria-hidden': true, focusable: false,
                          }, React.createElement('path', { d: 'M8 3v10M3 8h10', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' })))),
                        React.createElement('div', {
                          id: codexWorkspaceListId,
                          className: 'dshRemoteDirectoryList dshRemoteCodexWorkspaceList',
                          'aria-labelledby': codexWorkspaceHeadingId,
                        }, visibleCodexWorkspaces.length === 0
                          ? React.createElement('p', null, t('noCodexWorkspaces'))
                          : visibleCodexWorkspaces.map(workspace => React.createElement('button', {
                            type: 'button',
                            key: workspace.workspaceId,
                            disabled: busy,
                            className: workspaceBackend === 'codex' && codexWorkspaceId === workspace.workspaceId ? 'isSelected' : '',
                            'aria-pressed': workspaceBackend === 'codex' && codexWorkspaceId === workspace.workspaceId,
                            onClick: () => {
                              setWorkspaceBackend('codex')
                              setCodexWorkspaceId(workspace.workspaceId)
                              setCursorWorkspaceId(undefined)
                              setPath(workspace.path)
                            },
                            onDoubleClick: () => void openWorkspace({
                              backend: 'codex',
                              path: workspace.path,
                              workspaceId: workspace.workspaceId,
                            }),
                          }, React.createElement('img', { className: 'dshRemoteWorkspaceIcon isGpt', src: gptWorkspaceIcon, alt: '', 'aria-hidden': true }),
                            React.createElement('span', null, workspace.title),
                            React.createElement('small', null, `${workspace.path} · ${workspace.sessionCount}`)))),
                        codexWorkspaces.length <= 3 || showAllCodexWorkspaces ? null : React.createElement('button', {
                          type: 'button',
                          className: 'dshRemoteWorkspaceMore',
                          disabled: busy,
                          'aria-controls': codexWorkspaceListId,
                          'aria-label': t('showAllCodexWorkspaces'),
                          onClick: () => setShowAllCodexWorkspaces(true),
                        }, React.createElement('span', { 'aria-hidden': true }, '…'))),
                      !cursorAvailable ? null : React.createElement('section', { className: 'dshRemoteCodexWorkspaceGroup' },
                        React.createElement('div', {
                          id: cursorWorkspaceHeadingId,
                          className: 'dshRemoteWorkspaceSourceHeading',
                        }, React.createElement('span', { className: 'dshRemoteWorkspaceSourceText' },
                          React.createElement('strong', null, t('cursorVirtualWorkspace'))),
                          !cursorAvailable ? null : React.createElement('button', {
                            type: 'button',
                            className: 'dshRemoteAddWorkspace',
                            disabled: busy,
                            title: t('addCursorWorkspace'),
                            'aria-label': t('addCursorWorkspace'),
                            onClick: () => startAddingWorkspace('cursor'),
                          }, React.createElement('svg', {
                            className: 'dshRemoteAddWorkspaceIcon', viewBox: '0 0 16 16', 'aria-hidden': true, focusable: false,
                          }, React.createElement('path', { d: 'M8 3v10M3 8h10', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' })))),
                        React.createElement('div', {
                          id: cursorWorkspaceListId,
                          className: 'dshRemoteDirectoryList dshRemoteCodexWorkspaceList',
                          'aria-labelledby': cursorWorkspaceHeadingId,
                        }, visibleCursorWorkspaces.length === 0
                          ? React.createElement('p', null, t('noCursorWorkspaces'))
                          : visibleCursorWorkspaces.map(workspace => React.createElement('button', {
                            type: 'button',
                            key: workspace.workspaceId,
                            disabled: busy,
                            className: workspaceBackend === 'cursor' && cursorWorkspaceId === workspace.workspaceId ? 'isSelected' : '',
                            'aria-pressed': workspaceBackend === 'cursor' && cursorWorkspaceId === workspace.workspaceId,
                            onClick: () => {
                              setWorkspaceBackend('cursor')
                              setCursorWorkspaceId(workspace.workspaceId)
                              setCodexWorkspaceId(undefined)
                              setAntigravityWorkspaceId(undefined)
                              setPiWorkspaceId(undefined)
                              setOpencodeWorkspaceId(undefined)
                              setClaudeWorkspaceId(undefined)
                              setHermesWorkspaceId(undefined)
                              setPath(workspace.path)
                            },
                            onDoubleClick: () => void openWorkspace({
                              backend: 'cursor',
                              path: workspace.path,
                              workspaceId: workspace.workspaceId,
                            }),
                          }, React.createElement('img', { className: 'dshRemoteWorkspaceIcon', src: deepSeekWorkspaceIcon, alt: '', 'aria-hidden': true }),
                            React.createElement('span', null, workspace.title),
                            React.createElement('small', null, `${workspace.path} · ${workspace.sessionCount}`)))),
                        cursorWorkspaces.length <= 3 || showAllCursorWorkspaces ? null : React.createElement('button', {
                          type: 'button',
                          className: 'dshRemoteWorkspaceMore',
                          disabled: busy,
                          'aria-controls': cursorWorkspaceListId,
                          'aria-label': t('showAllCursorWorkspaces'),
                          onClick: () => setShowAllCursorWorkspaces(true),
                        }, React.createElement('span', { 'aria-hidden': true }, '…'))),
                      !antigravityAvailable ? null : React.createElement('section', { className: 'dshRemoteCodexWorkspaceGroup' },
                        React.createElement('div', {
                          id: antigravityWorkspaceHeadingId,
                          className: 'dshRemoteWorkspaceSourceHeading',
                        }, React.createElement('span', { className: 'dshRemoteWorkspaceSourceText' },
                          React.createElement('strong', null, t('antigravityVirtualWorkspace'))),
                          !antigravityAvailable ? null : React.createElement('button', {
                            type: 'button',
                            className: 'dshRemoteAddWorkspace',
                            disabled: busy,
                            title: t('addAntigravityWorkspace'),
                            'aria-label': t('addAntigravityWorkspace'),
                            onClick: () => startAddingWorkspace('antigravity'),
                          }, React.createElement('svg', {
                            className: 'dshRemoteAddWorkspaceIcon', viewBox: '0 0 16 16', 'aria-hidden': true, focusable: false,
                          }, React.createElement('path', { d: 'M8 3v10M3 8h10', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' })))),
                        React.createElement('div', {
                          id: antigravityWorkspaceListId,
                          className: 'dshRemoteDirectoryList dshRemoteCodexWorkspaceList',
                          'aria-labelledby': antigravityWorkspaceHeadingId,
                        }, visibleAntigravityWorkspaces.length === 0
                          ? React.createElement('p', null, t('noAntigravityWorkspaces'))
                          : visibleAntigravityWorkspaces.map(workspace => React.createElement('button', {
                            type: 'button',
                            key: workspace.workspaceId,
                            disabled: busy,
                            className: workspaceBackend === 'antigravity' && antigravityWorkspaceId === workspace.workspaceId ? 'isSelected' : '',
                            'aria-pressed': workspaceBackend === 'antigravity' && antigravityWorkspaceId === workspace.workspaceId,
                            onClick: () => {
                              setWorkspaceBackend('antigravity')
                              setAntigravityWorkspaceId(workspace.workspaceId)
                              setPiWorkspaceId(undefined)
                              setOpencodeWorkspaceId(undefined)
                              setClaudeWorkspaceId(undefined)
                              setHermesWorkspaceId(undefined)
                              setCodexWorkspaceId(undefined)
                              setCursorWorkspaceId(undefined)
                              setPath(workspace.path)
                            },
                            onDoubleClick: () => void openWorkspace({
                              backend: 'antigravity',
                              path: workspace.path,
                              workspaceId: workspace.workspaceId,
                            }),
                          }, React.createElement('img', { className: 'dshRemoteWorkspaceIcon', src: deepSeekWorkspaceIcon, alt: '', 'aria-hidden': true }),
                            React.createElement('span', null, workspace.title),
                            React.createElement('small', null, `${workspace.path} · ${workspace.sessionCount}`)))),
                        antigravityWorkspaces.length <= 3 || showAllAntigravityWorkspaces ? null : React.createElement('button', {
                          type: 'button',
                          className: 'dshRemoteWorkspaceMore',
                          disabled: busy,
                          'aria-controls': antigravityWorkspaceListId,
                          'aria-label': t('showAllAntigravityWorkspaces'),
                          onClick: () => setShowAllAntigravityWorkspaces(true),
                        }, React.createElement('span', { 'aria-hidden': true }, '…'))),
                      !piAvailable ? null : React.createElement('section', { className: 'dshRemoteCodexWorkspaceGroup' },
                        React.createElement('div', {
                          id: piWorkspaceHeadingId,
                          className: 'dshRemoteWorkspaceSourceHeading',
                        }, React.createElement('span', { className: 'dshRemoteWorkspaceSourceText' },
                          React.createElement('strong', null, t('piVirtualWorkspace'))),
                          !piAvailable ? null : React.createElement('button', {
                            type: 'button',
                            className: 'dshRemoteAddWorkspace',
                            disabled: busy,
                            title: t('addPiWorkspace'),
                            'aria-label': t('addPiWorkspace'),
                            onClick: () => startAddingWorkspace('pi'),
                          }, React.createElement('svg', {
                            className: 'dshRemoteAddWorkspaceIcon', viewBox: '0 0 16 16', 'aria-hidden': true, focusable: false,
                          }, React.createElement('path', { d: 'M8 3v10M3 8h10', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' })))),
                        React.createElement('div', {
                          id: piWorkspaceListId,
                          className: 'dshRemoteDirectoryList dshRemoteCodexWorkspaceList',
                          'aria-labelledby': piWorkspaceHeadingId,
                        }, visiblePiWorkspaces.length === 0
                          ? React.createElement('p', null, t('noPiWorkspaces'))
                          : visiblePiWorkspaces.map(workspace => React.createElement('button', {
                            type: 'button',
                            key: workspace.workspaceId,
                            disabled: busy,
                            className: workspaceBackend === 'pi' && piWorkspaceId === workspace.workspaceId ? 'isSelected' : '',
                            'aria-pressed': workspaceBackend === 'pi' && piWorkspaceId === workspace.workspaceId,
                            onClick: () => {
                              setWorkspaceBackend('pi')
                              setPiWorkspaceId(workspace.workspaceId)
                              setAntigravityWorkspaceId(undefined)
                              setCodexWorkspaceId(undefined)
                              setCursorWorkspaceId(undefined)
                              setPath(workspace.path)
                            },
                            onDoubleClick: () => void openWorkspace({
                              backend: 'pi',
                              path: workspace.path,
                              workspaceId: workspace.workspaceId,
                            }),
                          }, React.createElement('img', { className: 'dshRemoteWorkspaceIcon', src: deepSeekWorkspaceIcon, alt: '', 'aria-hidden': true }),
                            React.createElement('span', null, workspace.title),
                            React.createElement('small', null, `${workspace.path} · ${workspace.sessionCount}`)))),
                        piWorkspaces.length <= 3 || showAllPiWorkspaces ? null : React.createElement('button', {
                          type: 'button',
                          className: 'dshRemoteWorkspaceMore',
                          disabled: busy,
                          'aria-controls': piWorkspaceListId,
                          'aria-label': t('showAllPiWorkspaces'),
                          onClick: () => setShowAllPiWorkspaces(true),
                        }, React.createElement('span', { 'aria-hidden': true }, '…'))),
                      !opencodeAvailable ? null : React.createElement('section', { className: 'dshRemoteCodexWorkspaceGroup' },
                        React.createElement('div', {
                          id: opencodeWorkspaceHeadingId,
                          className: 'dshRemoteWorkspaceSourceHeading',
                        },
                          React.createElement('span', { className: 'dshRemoteWorkspaceSourceText' }, React.createElement('strong', null, t('opencodeVirtualWorkspace'))),
                          React.createElement('button', {
                            type: 'button',
                            className: 'dshRemoteAddWorkspace',
                            disabled: busy,
                            title: t('addOpencodeWorkspace'),
                            'aria-label': t('addOpencodeWorkspace'),
                            onClick: () => startAddingWorkspace('opencode'),
                          }, React.createElement('svg', {
                            className: 'dshRemoteAddWorkspaceIcon', viewBox: '0 0 16 16', 'aria-hidden': true, focusable: false,
                          }, React.createElement('path', { d: 'M8 3v10M3 8h10', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' })))),
                        React.createElement('div', {
                          id: opencodeWorkspaceListId,
                          className: 'dshRemoteDirectoryList dshRemoteCodexWorkspaceList',
                          'aria-labelledby': opencodeWorkspaceHeadingId,
                        }, visibleOpencodeWorkspaces.length === 0
                          ? React.createElement('p', null, t('noOpencodeWorkspaces'))
                          : visibleOpencodeWorkspaces.map(workspace => React.createElement('button', {
                            type: 'button',
                            key: workspace.workspaceId,
                            disabled: busy,
                            className: workspaceBackend === 'opencode' && opencodeWorkspaceId === workspace.workspaceId ? 'isSelected' : '',
                            'aria-pressed': workspaceBackend === 'opencode' && opencodeWorkspaceId === workspace.workspaceId,
                            onClick: () => {
                              setWorkspaceBackend('opencode')
                              setOpencodeWorkspaceId(workspace.workspaceId)
                              setPiWorkspaceId(undefined)
                              setClaudeWorkspaceId(undefined)
                              setHermesWorkspaceId(undefined)
                              setAntigravityWorkspaceId(undefined)
                              setCodexWorkspaceId(undefined)
                              setCursorWorkspaceId(undefined)
                              setPath(workspace.path)
                            },
                            onDoubleClick: () => void openWorkspace({
                              backend: 'opencode',
                              path: workspace.path,
                              workspaceId: workspace.workspaceId,
                            }),
                          }, React.createElement('img', { className: 'dshRemoteWorkspaceIcon', src: deepSeekWorkspaceIcon, alt: '', 'aria-hidden': true }),
                            React.createElement('span', null, workspace.title),
                            React.createElement('small', null, `${workspace.path} · ${workspace.sessionCount}`)))),
                        opencodeWorkspaces.length <= 3 || showAllOpencodeWorkspaces ? null : React.createElement('button', {
                          type: 'button',
                          className: 'dshRemoteWorkspaceMore',
                          disabled: busy,
                          'aria-controls': opencodeWorkspaceListId,
                          'aria-label': t('showAllOpencodeWorkspaces'),
                          onClick: () => setShowAllOpencodeWorkspaces(true),
                        }, React.createElement('span', { 'aria-hidden': true }, '…'))),
                      !hermesAvailable ? null : React.createElement('section', { className: 'dshRemoteCodexWorkspaceGroup' },
                        React.createElement('div', {
                          id: hermesWorkspaceHeadingId,
                          className: 'dshRemoteWorkspaceSourceHeading',
                        },
                          React.createElement('span', { className: 'dshRemoteWorkspaceSourceText' }, React.createElement('strong', null, t('hermesVirtualWorkspace'))),
                          React.createElement('button', {
                            type: 'button',
                            className: 'dshRemoteAddWorkspace',
                            disabled: busy,
                            title: t('addHermesWorkspace'),
                            'aria-label': t('addHermesWorkspace'),
                            onClick: () => startAddingWorkspace('hermes'),
                          }, React.createElement('svg', {
                            className: 'dshRemoteAddWorkspaceIcon', viewBox: '0 0 16 16', 'aria-hidden': true, focusable: false,
                          }, React.createElement('path', { d: 'M8 3v10M3 8h10', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' })))),
                        React.createElement('div', {
                          id: hermesWorkspaceListId,
                          className: 'dshRemoteDirectoryList dshRemoteCodexWorkspaceList',
                          'aria-labelledby': hermesWorkspaceHeadingId,
                        }, visibleHermesWorkspaces.length === 0
                          ? React.createElement('p', null, t('noHermesWorkspaces'))
                          : visibleHermesWorkspaces.map(workspace => React.createElement('button', {
                            type: 'button',
                            key: workspace.workspaceId,
                            disabled: busy,
                            className: workspaceBackend === 'hermes' && hermesWorkspaceId === workspace.workspaceId ? 'isSelected' : '',
                            'aria-pressed': workspaceBackend === 'hermes' && hermesWorkspaceId === workspace.workspaceId,
                            onClick: () => {
                              setWorkspaceBackend('hermes')
                              setClaudeWorkspaceId(undefined)
                              setHermesWorkspaceId(workspace.workspaceId)
                              setPiWorkspaceId(undefined)
                              setOpencodeWorkspaceId(undefined)
                              setAntigravityWorkspaceId(undefined)
                              setCodexWorkspaceId(undefined)
                              setCursorWorkspaceId(undefined)
                              setPath(workspace.path)
                            },
                            onDoubleClick: () => void openWorkspace({
                              backend: 'hermes',
                              path: workspace.path,
                              workspaceId: workspace.workspaceId,
                            }),
                          }, React.createElement('img', { className: 'dshRemoteWorkspaceIcon', src: deepSeekWorkspaceIcon, alt: '', 'aria-hidden': true }),
                            React.createElement('span', null, workspace.title),
                            React.createElement('small', null, `${workspace.path} · ${workspace.sessionCount}`)))),
                        hermesWorkspaces.length <= 3 || showAllHermesWorkspaces ? null : React.createElement('button', {
                          type: 'button',
                          className: 'dshRemoteWorkspaceMore',
                          disabled: busy,
                          'aria-controls': hermesWorkspaceListId,
                          'aria-label': t('showAllHermesWorkspaces'),
                          onClick: () => setShowAllHermesWorkspaces(true),
                        }, React.createElement('span', { 'aria-hidden': true }, '…'))),
                      !claudeAvailable ? null : React.createElement('section', { className: 'dshRemoteCodexWorkspaceGroup' },
                        React.createElement('div', {
                          id: claudeWorkspaceHeadingId,
                          className: 'dshRemoteWorkspaceSourceHeading',
                        },
                          React.createElement('span', { className: 'dshRemoteWorkspaceSourceText' }, React.createElement('strong', null, t('claudeVirtualWorkspace'))),
                          React.createElement('button', {
                            type: 'button',
                            className: 'dshRemoteAddWorkspace',
                            disabled: busy,
                            title: t('addClaudeWorkspace'),
                            'aria-label': t('addClaudeWorkspace'),
                            onClick: () => startAddingWorkspace('claude'),
                          }, React.createElement('svg', {
                            className: 'dshRemoteAddWorkspaceIcon', viewBox: '0 0 16 16', 'aria-hidden': true, focusable: false,
                          }, React.createElement('path', { d: 'M8 3v10M3 8h10', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' })))),
                        React.createElement('div', {
                          id: claudeWorkspaceListId,
                          className: 'dshRemoteDirectoryList dshRemoteCodexWorkspaceList',
                          'aria-labelledby': claudeWorkspaceHeadingId,
                        }, visibleClaudeWorkspaces.length === 0
                          ? React.createElement('p', null, t('noClaudeWorkspaces'))
                          : visibleClaudeWorkspaces.map(workspace => React.createElement('button', {
                            type: 'button',
                            key: workspace.workspaceId,
                            disabled: busy,
                            className: workspaceBackend === 'claude' && claudeWorkspaceId === workspace.workspaceId ? 'isSelected' : '',
                            'aria-pressed': workspaceBackend === 'claude' && claudeWorkspaceId === workspace.workspaceId,
                            onClick: () => {
                              setWorkspaceBackend('claude')
                              setClaudeWorkspaceId(workspace.workspaceId)
                              setHermesWorkspaceId(undefined)
                              setPiWorkspaceId(undefined)
                              setOpencodeWorkspaceId(undefined)
                              setAntigravityWorkspaceId(undefined)
                              setCodexWorkspaceId(undefined)
                              setCursorWorkspaceId(undefined)
                              setPath(workspace.path)
                            },
                            onDoubleClick: () => void openWorkspace({
                              backend: 'claude',
                              path: workspace.path,
                              workspaceId: workspace.workspaceId,
                            }),
                          }, React.createElement('img', { className: 'dshRemoteWorkspaceIcon', src: deepSeekWorkspaceIcon, alt: '', 'aria-hidden': true }),
                            React.createElement('span', null, workspace.title),
                            React.createElement('small', null, `${workspace.path} · ${workspace.sessionCount}`)))),
                        claudeWorkspaces.length <= 3 || showAllClaudeWorkspaces ? null : React.createElement('button', {
                          type: 'button',
                          className: 'dshRemoteWorkspaceMore',
                          disabled: busy,
                          'aria-controls': claudeWorkspaceListId,
                          'aria-label': t('showAllClaudeWorkspaces'),
                          onClick: () => setShowAllClaudeWorkspaces(true),
                        }, React.createElement('span', { 'aria-hidden': true }, '…')))),
                      React.createElement('footer', { className: 'dshRemoteOpenBar' },
                    React.createElement('div', null, React.createElement('span', null, t('currentDirectory')), React.createElement('strong', null, path || '—')),
                    React.createElement('button', {
                      type: 'button',
                      disabled: busy || path.trim() === ''
                        || !addingWorkspace && workspaceBackend === 'codex' && codexWorkspaceId === undefined
                        || !addingWorkspace && workspaceBackend === 'cursor' && cursorWorkspaceId === undefined && path === ''
                        || !addingWorkspace && workspaceBackend === 'antigravity' && antigravityWorkspaceId === undefined && path === ''
                        || !addingWorkspace && workspaceBackend === 'pi' && piWorkspaceId === undefined && path === ''
                        || !addingWorkspace && workspaceBackend === 'opencode' && opencodeWorkspaceId === undefined && path === ''
                        || !addingWorkspace && workspaceBackend === 'claude' && claudeWorkspaceId === undefined && path === ''
                        || !addingWorkspace && workspaceBackend === 'hermes' && hermesWorkspaceId === undefined && path === '',
                      onClick: () => void openWorkspace(),
                    }, t(busy ? 'openingWorkspace' : addingWorkspace ? 'confirmAddWorkspace' : 'openWorkspace')))))),
          notice === undefined ? null : React.createElement('p', { className: 'dshRemoteNotice', role: 'status' }, notice),
              error === undefined ? null : React.createElement('p', { className: 'dshRemoteError', role: 'alert' }, error))))))
  }

  return RemoteWorkspaceAction
}
