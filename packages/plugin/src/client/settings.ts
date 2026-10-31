import QRCode from 'qrcode'
import type { LocalizedMessage, Translate } from '../client-locale.js'
import type { OAuthProviderInfo } from '../server-api.js'
import type { StatusFeed } from '../status-stream.js'
import {
  connectionErrorMessage,
  connectionStatusClass,
  connectionStatusLabel,
  formatLocalTime,
  messageOf,
} from './presentation.js'
import type {
  ClientReact,
  LoginMethod,
  OAuthProvider,
  OAuthQrPollResult,
  OAuthQrSession,
  PluginAssociation,
  PluginConfigureResult,
  PluginSettingsView,
  RemoteStatus,
  SidebarEntryPreference,
  SidebarEntryStyle,
} from './types.js'

const sidebarEntryChoices: ReadonlyArray<{ value: SidebarEntryStyle; label: 'sidebarEntryStandard' | 'sidebarEntryCompact' }> = [
  { value: 'standard', label: 'sidebarEntryStandard' },
  { value: 'compact', label: 'sidebarEntryCompact' },
]

export function createRemotePluginOptions(React: ClientReact) {
  function RemotePluginOptions(props: {
    control: <T>(endpoint: string, payload?: unknown) => Promise<T>
    statusFeed: StatusFeed<RemoteStatus>
    onSignIn?: () => void
    preferredQrProvider?: string
    sidebarEntry: SidebarEntryPreference
    t: Translate
    view?: 'summary' | 'page'
  }): unknown {
    const { t } = props
    const [open, setOpen] = React.useState(props.view === 'page')
    const [serverUrl, setServerUrl] = React.useState('')
    const [remoteToolsBusy, setRemoteToolsBusy] = React.useState(false)
    const [remoteToolsEnabled, setRemoteToolsEnabled] = React.useState(true)
    const [associations, setAssociations] = React.useState<Partial<Record<'host' | 'client', PluginAssociation>>>({})
    const [loaded, setLoaded] = React.useState(false)
    const [writable, setWritable] = React.useState(false)
    const [busy, setBusy] = React.useState(false)
    const [terminalEnabled, setTerminalEnabled] = React.useState(false)
    const [terminalBusy, setTerminalBusy] = React.useState(false)
    const [sidebarEntry, setSidebarEntry] = React.useState<SidebarEntryStyle>(() => props.sidebarEntry.read())
    const [sidebarEntryBusy, setSidebarEntryBusy] = React.useState(false)
    const [acpBackends, setAcpBackends] = React.useState<Array<{ id: string; enabled: boolean }>>([])
    const [acpAvailability, setAcpAvailability] = React.useState<Record<string, boolean>>({})
    const [acpChecking, setAcpChecking] = React.useState<Record<string, boolean>>({})
    const [acpCheckResults, setAcpCheckResults] = React.useState<Record<string, boolean | undefined>>({})
    const [reconnectBusy, setReconnectBusy] = React.useState(false)
    const [hostStatus, setHostStatus] = React.useState<RemoteStatus['host'] | undefined>(undefined)
    const [hostName, setHostName] = React.useState('')
    const [hostDeviceId, setHostDeviceId] = React.useState('')
    const [notice, setNotice] = React.useState<LocalizedMessage | undefined>(undefined)
    const [error, setError] = React.useState<string | undefined>(undefined)
    const [settingsView, setSettingsView] = React.useState<PluginSettingsView | undefined>(undefined)

    // Inline Sign-In state (folds/unfolds inside the settings card without modal dialog)
    const [signInOpen, setSignInOpen] = React.useState(false)
    const [loginEmail, setLoginEmail] = React.useState('')
    const [loginPassword, setLoginPassword] = React.useState('')
    const [loginMethod, setLoginMethod] = React.useState<LoginMethod>('password')
    const [oauthProviders, setOAuthProviders] = React.useState<OAuthProviderInfo[]>([])
    const [providersLoading, setProvidersLoading] = React.useState(false)
    const [providersFailed, setProvidersFailed] = React.useState(false)
    const [qrSession, setQrSession] = React.useState<OAuthQrSession | undefined>(undefined)
    const [qrImage, setQrImage] = React.useState<string | undefined>(undefined)
    const [qrExpired, setQrExpired] = React.useState(false)
    const [qrFailed, setQrFailed] = React.useState(false)
    const [qrBusy, setQrBusy] = React.useState(false)
    const [qrCompleted, setQrCompleted] = React.useState(false)
    const [providerReload, setProviderReload] = React.useState(0)
    const [completionReload, setCompletionReload] = React.useState(0)
    const qrFlowRun = React.useRef(0)
    const providerRequestRun = React.useRef(0)
    const loginMethodManuallySelected = React.useRef(false)

    const associationReadRun = React.useRef(0)
    const association = associations.client ?? associations.host

    const applyAssociations = (view: PluginSettingsView): void => {
      setAssociations(view.associations ?? (view.association === undefined ? {} : { host: view.association }))
    }

    const applyView = (view: PluginSettingsView, updateAssociations = true): void => {
      setSettingsView(view)
      setServerUrl(view.config.serverUrl ?? 'https://dsh.r2049.cn')
      setTerminalEnabled(view.config.terminal?.enabled ?? true)
      setRemoteToolsEnabled(view.config.remoteTools?.enabled ?? true)
      setSidebarEntry(view.config.sidebar?.entry ?? 'standard')
      props.sidebarEntry.publish(view.config.sidebar?.entry ?? 'standard')
      setAcpBackends((view.config.acp?.backends ?? []).map(item => ({ id: item.id, enabled: item.enabled !== false })))
      setAcpAvailability(view.acpAvailability ?? {})
      if (updateAssociations) applyAssociations(view)
      setWritable(view.writable)
      setLoaded(true)
    }

    const load = async (): Promise<void> => {
      const run = ++associationReadRun.current
      const [view, status] = await Promise.all([
        props.control<PluginSettingsView>('settings.get'),
        props.control<RemoteStatus>('status').catch(() => undefined),
      ])
      applyView(view, run === associationReadRun.current)
      setHostStatus(status?.host)
      setHostName(status?.deviceName ?? '')
      setHostDeviceId(status?.host?.deviceId ?? '')
    }

    React.useEffect(() => {
      void load().catch(reason => setError(messageOf(reason)))
    }, [])

    React.useEffect(() => {
      let active = true
      let authorizationKey: string | undefined
      const unsubscribe = props.statusFeed.subscribe(status => {
        setHostStatus(status.host)
        setHostName(status.deviceName ?? '')
        setHostDeviceId(status.host?.deviceId ?? '')
        // Either account entry point rotates these identities on sign-out.
        // Refresh the read-only settings snapshot on that change without
        // fetching settings for ordinary connection/statistics updates.
        const key = JSON.stringify([status.serverUrl, status.deviceId, status.host?.deviceId,
          status.host?.authorized, status.host?.account])
        if (key === authorizationKey) return
        authorizationKey = key
        const run = ++associationReadRun.current
        void props.control<PluginSettingsView>('settings.get').then(view => {
          if (active && run === associationReadRun.current) applyView(view)
        }).catch(() => undefined)
      })
      return () => { active = false; unsubscribe() }
    }, [props.statusFeed])

    React.useEffect(() => {
      if (!signInOpen) return
      let active = true
      const run = ++providerRequestRun.current
      qrFlowRun.current += 1
      setQrSession(undefined)
      setQrImage(undefined)
      setQrExpired(false)
      setQrFailed(false)
      setQrBusy(false)
      setQrCompleted(false)
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
    }, [signInOpen, props.preferredQrProvider, providerReload])

    React.useEffect(() => {
      if (!signInOpen || providersLoading || loginMethod === 'password'
        || !oauthProviders.some(item => `oauth:${item.id}` === loginMethod)
        || qrSession !== undefined || qrExpired || qrFailed || qrCompleted) return
      let active = true
      const run = ++qrFlowRun.current
      setQrBusy(true)
      setQrFailed(false)
      setError(undefined)
      setQrExpired(false)
      void props.control<OAuthQrSession>('client.account.qr.start', { provider: loginMethod.slice(6) })
        .then(async session => {
          if (!active || run !== qrFlowRun.current) return
          const image = await QRCode.toDataURL(session.scanUrl, {
            width: 184,
            margin: 1,
            errorCorrectionLevel: 'L',
          })
          if (!active || run !== qrFlowRun.current) return
          setQrSession(session)
          setQrImage(image)
        })
        .catch(reason => {
          if (!active || run !== qrFlowRun.current) return
          setQrFailed(true)
          setError(messageOf(reason))
        })
        .finally(() => {
          if (active && run === qrFlowRun.current) setQrBusy(false)
        })
      return () => { active = false }
    }, [signInOpen, providersLoading, oauthProviders, loginMethod, qrSession, qrExpired, qrFailed, providerReload])

    React.useEffect(() => {
      if (!signInOpen || loginMethod === 'password' || qrSession === undefined) return
      let active = true
      let polling = false
      let settled = false
      const run = qrFlowRun.current
      let timer: ReturnType<typeof setInterval> | undefined
      const poll = (): void => {
        if (polling || settled || !active || run !== qrFlowRun.current) return
        polling = true
        void props.control<OAuthQrPollResult>('client.account.qr.poll', { qrId: qrSession.qrId }).then(result => {
          if (!active || settled || run !== qrFlowRun.current) return
          if (result.status === 'complete') {
            settled = true
            if (timer !== undefined) clearInterval(timer)
            setError(undefined)
            setQrExpired(false)
            setQrCompleted(true)
            setQrSession(undefined)
            setQrImage(undefined)
            setQrBusy(false)
          } else if (result.status === 'expired') {
            settled = true
            if (timer !== undefined) clearInterval(timer)
            setQrExpired(true)
            setQrSession(undefined)
            setQrImage(undefined)
            setQrBusy(false)
          }
        }).catch(reason => {
          if (active && !settled && run === qrFlowRun.current) setError(messageOf(reason))
        }).finally(() => {
          polling = false
        })
      }
      poll()
      timer = setInterval(poll, 1_500)
      return () => {
        active = false
        settled = true
        if (timer !== undefined) clearInterval(timer)
      }
    }, [signInOpen, loginMethod, qrSession])

    // Dedicated settings refresh effect on QR authorization completion
    React.useEffect(() => {
      if (!signInOpen || !qrCompleted) return
      let active = true
      setError(undefined)
      void props.control<PluginSettingsView>('settings.get')
        .then(view => {
          if (!active) return
          applyView(view)
          setSignInOpen(false)
          setQrCompleted(false)
          setLoginPassword('')
          setNotice({ key: 'authorizationComplete' })
        })
        .catch(reason => {
          if (!active) return
          setError(messageOf(reason))
        })
      return () => {
        active = false
      }
    }, [signInOpen, qrCompleted, completionReload])

    const signInClient = async (): Promise<void> => {
      if (loginEmail.trim() === '' || loginPassword === '') return
      setBusy(true)
      setError(undefined)
      try {
        const result = await props.control<PluginConfigureResult>('settings.configure', {
          role: 'client',
          serverUrl: serverUrl.trim() || 'https://dsh.r2049.cn',
          email: loginEmail.trim(),
          password: loginPassword,
        })
        applyView(result.settings)
        setSignInOpen(false)
        setLoginPassword('')
        setNotice({ key: 'authorizationComplete' })
      } catch (reason) {
        setError(messageOf(reason))
      } finally {
        setBusy(false)
      }
    }

    const selectLoginMethod = (method: LoginMethod): void => {
      loginMethodManuallySelected.current = true
      if (method === loginMethod) return
      qrFlowRun.current += 1
      setLoginMethod(method)
      setQrSession(undefined)
      setQrImage(undefined)
      setQrExpired(false)
      setQrFailed(false)
      setQrBusy(false)
      setQrCompleted(false)
      setError(undefined)
    }

    const logout = async (): Promise<void> => {
      const run = ++associationReadRun.current
      setBusy(true)
      setError(undefined)
      setNotice(undefined)
      try {
        const view = await props.control<PluginSettingsView>('settings.logout')
        applyView(view, run === associationReadRun.current)
        setSignInOpen(false)
        setNotice({ key: 'signedOut' })
      } catch (reason) {
        setError(messageOf(reason))
      } finally {
        setBusy(false)
      }
    }

    const reconnectHost = async (): Promise<void> => {
      setReconnectBusy(true)
      setError(undefined)
      setNotice(undefined)
      try {
        const status = await props.control<RemoteStatus>('host.reconnect')
        setHostStatus(status.host)
        setNotice({ key: 'reconnectStarted' })
      } catch (reason) {
        setError(messageOf(reason))
      } finally {
        setReconnectBusy(false)
      }
    }

    const setCurrentDeviceControl = async (enabled: boolean): Promise<void> => {
      setBusy(true)
      setError(undefined)
      setNotice(undefined)
      try {
        const status = await props.control<RemoteStatus>('host.authorization.set', { enabled })
        setHostStatus(status.host)
      } catch (reason) {
        setError(messageOf(reason))
      } finally {
        setBusy(false)
      }
    }

    const setTerminalRemote = async (enabled: boolean): Promise<void> => {
      const previous = terminalEnabled
      setTerminalEnabled(enabled)
      setTerminalBusy(true)
      setError(undefined)
      setNotice(undefined)
      try {
        const view = await props.control<PluginSettingsView>('settings.development.set', { terminalEnabled: enabled })
        applyView(view)
        setNotice({ key: 'terminalSaved' })
      } catch (reason) {
        setTerminalEnabled(previous)
        setError(messageOf(reason))
      } finally {
        setTerminalBusy(false)
      }
    }

    const setSidebarEntryStyle = async (entry: SidebarEntryStyle): Promise<void> => {
      if (entry === sidebarEntry) return
      const previous = sidebarEntry
      setSidebarEntry(entry)
      setSidebarEntryBusy(true)
      setError(undefined)
      setNotice(undefined)
      try {
        const view = await props.control<PluginSettingsView>('settings.appearance.set', { sidebarEntry: entry })
        applyView(view)
        setNotice({ key: 'sidebarEntrySaved' })
      } catch (reason) {
        setSidebarEntry(previous)
        setError(messageOf(reason))
      } finally {
        setSidebarEntryBusy(false)
      }
    }

    const setRemoteTools = async (enabled: boolean): Promise<void> => {
      setRemoteToolsBusy(true); setError(undefined); setNotice(undefined)
      try {
        // Include the terminal value for compatibility with older Hosts whose
        // development settings endpoint requires one of the legacy fields.
        const view = await props.control<PluginSettingsView>('settings.development.set', { remoteToolsEnabled: enabled, terminalEnabled })
        applyView(view)
        setNotice({ key: 'remoteToolsSaved' })
      }
      catch (reason) { setRemoteToolsEnabled(!enabled); setError(messageOf(reason)) }
      finally { setRemoteToolsBusy(false) }
    }

    const checkAcp = async (backend: string): Promise<void> => {
      if (acpChecking[backend]) return
      setAcpChecking(current => ({ ...current, [backend]: true }))
      setAcpCheckResults(current => ({ ...current, [backend]: undefined }))
      setError(undefined)
      try {
        const view = await props.control<PluginSettingsView>('settings.get')
        applyView(view)
        const available = view.acpAvailability?.[backend] === true
        if (!available && view.writable && view.config.acp?.backends?.some(item => item.id === backend && item.enabled !== false)) {
          applyView(await props.control<PluginSettingsView>('settings.acp.set', { backend, enabled: false }))
        }
        setAcpCheckResults(current => ({ ...current, [backend]: available }))
        setNotice({ key: available ? 'acpAvailable' : 'acpUnavailable' })
        setTimeout(() => setAcpCheckResults(current => ({ ...current, [backend]: undefined })), 5_000)
      } catch (reason) {
        setError(messageOf(reason))
      } finally {
        setAcpChecking(current => ({ ...current, [backend]: false }))
      }
    }

    const removeAcp = async (backend: string): Promise<void> => {
      setBusy(true)
      setError(undefined)
      try {
        const view = await props.control<PluginSettingsView>('settings.acp.remove', { id: backend })
        applyView(view)
      } catch (reason) {
        setError(messageOf(reason))
      } finally {
        setBusy(false)
      }
    }

    const developmentSetting = React.createElement('section', { className: 'dshRemoteDevelopmentSettings' },
      React.createElement('div', { className: 'dshRemoteAuthorizationSetting' },
        React.createElement('div', null,
          React.createElement('strong', null, t('terminalRemote')),
          React.createElement('p', null, t('terminalRemoteHint'))),
        React.createElement('input', {
          type: 'checkbox', role: 'switch', checked: terminalEnabled,
          disabled: busy || terminalBusy || !writable, 'aria-label': t('terminalRemote'),
          onChange: (event: Event) => void setTerminalRemote((event.target as HTMLInputElement).checked),
        })),
      React.createElement('div', { className: 'dshRemoteAuthorizationSetting' },
        React.createElement('div', null,
          React.createElement('strong', null, t('remoteTools')),
          React.createElement('p', null, t('remoteToolsHint'))),
        React.createElement('input', {
          type: 'checkbox', role: 'switch', checked: remoteToolsEnabled,
          disabled: remoteToolsBusy || !writable, 'aria-label': t('remoteTools'),
          onChange: (event: Event) => {
            const enabled = (event.target as HTMLInputElement).checked
            setRemoteToolsEnabled(enabled)
            void setRemoteTools(enabled)
          },
        })),
    )

    // The entry style is presentation only, so it lives beside the development
    // switches instead of inside the Host-facing settings block.
    const sidebarEntrySetting = React.createElement('div', { className: 'dshRemoteAuthorizationSetting' },
      React.createElement('div', null,
        React.createElement('strong', null, t('sidebarEntry')),
        React.createElement('p', null, t('sidebarEntryHint'))),
      React.createElement('div', {
        className: 'dshRemoteEntryStyleChoices',
        role: 'radiogroup',
        'aria-label': t('sidebarEntry'),
      }, sidebarEntryChoices.map(choice => React.createElement('button', {
        key: choice.value,
        type: 'button',
        role: 'radio',
        'aria-checked': sidebarEntry === choice.value,
        className: sidebarEntry === choice.value ? 'isSelected' : undefined,
        disabled: sidebarEntryBusy || !writable,
        onClick: () => void setSidebarEntryStyle(choice.value),
      }, t(choice.label)))))

    const acpSetting = React.createElement('details', { className: 'dshRemoteAuthorizationSetting dshRemoteAcpSetting' },
      React.createElement('summary', null,
        React.createElement('div', { className: 'dshRemoteAcpSummaryText' },
          React.createElement('strong', null, t('agentBackends')),
          React.createElement('p', null, t('acpHint'), React.createElement('a', {
            href: 'https://github.com/liguobao/ds-harness-remote/blob/feat/cursor-remote/docs/acp-remote.md',
            target: '_blank', rel: 'noopener noreferrer',
            onClick: (event: Event) => event.stopPropagation(),
          }, t('acpDocumentation'))))),
      React.createElement('div', { className: 'dshRemoteAcpList' }, acpBackends.map(item => React.createElement('div', { key: item.id, className: 'dshRemoteAuthorizationSetting' },
        React.createElement('div', null, React.createElement('strong', null, item.id === 'codex' ? 'CodeX' : item.id === 'cursor' ? 'Cursor' : item.id === 'antigravity' ? 'AGY' : item.id === 'claude' ? 'Claude' : item.id === 'pi' ? 'Pi' : item.id === 'opencode' ? 'OpenCode' : item.id), null),
        React.createElement('span', { className: 'dshRemoteAcpCheckCell' },
          React.createElement('a', { href: `#check-acp-${item.id}`, className: `dshRemoteAcpCheckLink${acpChecking[item.id] ? ' isChecking' : acpCheckResults[item.id] === undefined ? '' : acpCheckResults[item.id] ? ' isPassed' : ' isFailed'}`, onClick: (event: Event) => { event.preventDefault(); void checkAcp(item.id) } },
            acpChecking[item.id] ? t('checkingAcp') : acpCheckResults[item.id] === undefined ? t('checkAcp') : t(acpCheckResults[item.id] ? 'acpCheckPassed' : 'acpCheckFailed'))),
        ['codex', 'cursor', 'antigravity', 'pi', 'claude', 'opencode'].includes(item.id) ? null : React.createElement('a', { href: `#remove-acp-${item.id}`, className: 'dshRemoteAcpRemoveLink', onClick: (event: Event) => { event.preventDefault(); void removeAcp(item.id) } }, t('removeAcp')),
        React.createElement('input', {
          type: 'checkbox', role: 'switch', checked: settingsView?.config.acp?.enabled === true && item.enabled && acpAvailability[item.id] === true, 'aria-label': item.id, disabled: busy || !writable || acpChecking[item.id] === true || acpAvailability[item.id] !== true,
          onChange: (event: Event) => void props.control<PluginSettingsView>('settings.acp.set', { backend: item.id, enabled: (event.target as HTMLInputElement).checked }).then(view => { applyView(view); setAcpBackends((view.config.acp?.backends ?? []).map(v => ({ id: v.id, enabled: v.enabled !== false }))) }).catch(reason => setError(messageOf(reason)))
        }))),
        ))

    if (props.view === 'summary') return React.createElement('span', null, t('pluginDescription'))

    const orderedQrProviders = [...oauthProviders].sort((a, b) =>
      Number(b.id === props.preferredQrProvider) - Number(a.id === props.preferredQrProvider))
    const selectedProvider = oauthProviders.find(item => `oauth:${item.id}` === loginMethod)
    const scanLabel = t('scanWithProvider', { provider: selectedProvider?.displayName ?? '' })

    const qrLoginTab = (provider: OAuthProviderInfo): unknown => React.createElement('button', {
      key: provider.id, type: 'button', role: 'tab', id: `dsh-remote-settings-oauth:${provider.id}-tab`,
      'aria-selected': loginMethod === `oauth:${provider.id}`, 'aria-controls': `dsh-remote-settings-oauth:${provider.id}-panel`,
      className: loginMethod === `oauth:${provider.id}` ? 'isActive' : '', disabled: busy,
      onClick: () => selectLoginMethod(`oauth:${provider.id}`),
    }, provider.displayName)

    const inlineSignIn = !signInOpen ? null : React.createElement('div', {
      id: 'dsh-remote-inline-signin',
      className: 'dshRemoteInlineSignIn',
    },
      oauthProviders.length === 0 && !providersLoading ? null : React.createElement('div', { className: 'dshRemoteLoginTabs', role: 'tablist' },
        ...orderedQrProviders.map(qrLoginTab),
        React.createElement('button', {
          type: 'button', role: 'tab', id: 'dsh-remote-settings-password-tab',
          'aria-selected': loginMethod === 'password', 'aria-controls': 'dsh-remote-settings-password-panel',
          className: loginMethod === 'password' ? 'isActive' : '', disabled: busy,
          onClick: () => selectLoginMethod('password'),
        }, t('accountPasswordLogin'))),
      providersLoading ? React.createElement('p', { className: 'dshRemoteSettingsState', role: 'status' }, t('loadingLoginProviders')) : null,
      providersFailed ? React.createElement('button', {
        type: 'button', className: 'dshRemoteReconnect', disabled: busy,
        onClick: () => { setError(undefined); setProviderReload(v => v + 1) },
      }, t('retryLoginProviders')) : null,
      loginMethod !== 'password' && selectedProvider !== undefined
        ? React.createElement('div', {
          className: 'dshRemoteQrLogin', role: 'tabpanel', id: `dsh-remote-settings-${loginMethod}-panel`,
          'aria-labelledby': `dsh-remote-settings-${loginMethod}-tab`,
        },
          qrCompleted
            ? React.createElement('div', { className: 'dshRemoteInlineSignInQrState' },
              React.createElement('p', null, t('loadingSettings')),
              React.createElement('button', {
                type: 'button', className: 'dshRemoteReconnect', disabled: busy,
                onClick: () => {
                  setError(undefined)
                  setCompletionReload(v => v + 1)
                },
              }, t('retryLoginProviders')))
            : qrFailed
            ? React.createElement('div', { className: 'dshRemoteInlineSignInQrState' },
              React.createElement('p', null, t('retryLoginProviders')),
              React.createElement('button', {
                type: 'button', className: 'dshRemoteReconnect', disabled: qrBusy,
                onClick: () => {
                  setQrFailed(false)
                  setQrExpired(false)
                  setQrSession(undefined)
                  setQrImage(undefined)
                },
              }, t('retryLoginProviders')))
            : qrExpired
              ? React.createElement('div', { className: 'dshRemoteInlineSignInQrState' },
                React.createElement('p', null, t('qrLoginExpired')),
                React.createElement('button', {
                  type: 'button', className: 'dshRemoteReconnect', disabled: qrBusy,
                  onClick: () => {
                    setQrExpired(false)
                    setQrFailed(false)
                    setQrSession(undefined)
                    setQrImage(undefined)
                  },
                }, t('refreshQrCode')))
              : qrImage === undefined
                ? React.createElement('div', { className: 'dshRemoteQrPlaceholder', 'aria-busy': qrBusy },
                  React.createElement('span', null, t('checkingConnection')))
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
          React.createElement('p', null, t('scanLoginHint')))
        : React.createElement('div', {
          className: 'dshRemoteClientLogin', role: 'tabpanel', id: 'dsh-remote-settings-password-panel',
          'aria-labelledby': 'dsh-remote-settings-password-tab',
        },
          React.createElement('input', {
            type: 'email', value: loginEmail, disabled: busy, autoComplete: 'username', placeholder: t('account'),
            'aria-label': t('account'), onChange: (event: Event) => setLoginEmail((event.target as HTMLInputElement).value),
          }),
          React.createElement('input', {
            type: 'password', value: loginPassword, disabled: busy, autoComplete: 'current-password', placeholder: t('password'),
            'aria-label': t('password'), onChange: (event: Event) => setLoginPassword((event.target as HTMLInputElement).value),
          }),
          React.createElement('button', {
            type: 'button', disabled: busy || loginEmail.trim() === '' || loginPassword === '',
            onClick: () => void signInClient(),
          }, t(busy ? 'signingIn' : 'startSignIn'))),
    )

    return React.createElement(props.view === 'page' ? 'div' : 'li', { className: `dshRemotePluginCard${open ? ' isOpen' : ''}${props.view === 'page' ? ' dshRemotePluginModern' : ''}` },
      React.createElement('div', { className: 'dshRemotePluginCardHeader' },
        React.createElement('button', {
          type: 'button',
          className: 'dshRemotePluginCardToggle',
          'aria-expanded': open,
          'aria-label': t(open ? 'collapseSettings' : 'expandSettings', { name: t('pluginTitle') }),
          onClick: () => setOpen(current => !current),
        },
          React.createElement('span', { className: 'dshRemotePluginCardHeading' },
            React.createElement('strong', null, t('pluginTitle')),
            React.createElement('span', null, t('pluginDescription'))),
          association === undefined ? null : React.createElement('span', {
            className: `dshRemotePluginCardStatus${connectionStatusClass(hostStatus)}`,
          }, hostStatus === undefined ? t('associated') : connectionStatusLabel(hostStatus, t)),
          React.createElement('span', { className: 'dshRemotePluginCardChevron', 'aria-hidden': true }, '⌄'))),
      !open ? null : React.createElement('div', { className: 'dshRemotePluginCardBody' },
        !loaded
          ? React.createElement('p', { className: 'dshRemoteSettingsState' }, error ?? t('loadingSettings'))
          : association !== undefined
            ? React.createElement('div', { className: 'dshRemoteSettings' },
              React.createElement('div', { className: 'dshRemoteSettingsTop' },
                React.createElement('div', { className: 'dshRemoteAssociation' },
                  React.createElement('span', null, t(association.account === undefined ? 'authorization' : 'account')),
                  React.createElement('strong', null, association.account
                    ?? t('authorizationComplete')),
                  React.createElement('p', null, association.account === undefined
                    ? serverUrl
                    : t('authorizedOn', { role: 'Remote', serverUrl })))),
              React.createElement('div', { className: 'dshRemoteHostIdentity' },
                React.createElement('div', null,
                  React.createElement('span', null, t('hostName')),
                  React.createElement('strong', null, hostName || '—')),
                React.createElement('div', null,
                  React.createElement('span', null, t('deviceId')),
                  React.createElement('code', null, hostDeviceId || '—'))),
              developmentSetting,
              sidebarEntrySetting,
              acpSetting,
              React.createElement('div', { className: 'dshRemoteAuthorizationSetting' },
                React.createElement('div', null,
                  React.createElement('strong', null, t('allowControlCurrentDevice')),
                  React.createElement('p', null, t('thisMachineHost'))),
                React.createElement('input', {
                  type: 'checkbox', role: 'switch', disabled: busy,
                  'aria-label': t('allowControlCurrentDevice'),
                  checked: hostStatus?.authorized === true,
                  onChange: (event: Event) => void setCurrentDeviceControl((event.target as HTMLInputElement).checked),
                })),
              React.createElement('div', { className: 'dshRemoteConnection', 'aria-live': 'polite' },
                React.createElement('div', { className: 'dshRemoteConnectionSummary' },
                  React.createElement('span', null, t('connection')),
                  React.createElement('strong', null,
                    React.createElement('span', {
                      className: `dshRemoteConnectionDot${connectionStatusClass(hostStatus)}`,
                      'aria-hidden': true,
                    }),
                    connectionStatusLabel(hostStatus, t)),
                  React.createElement('p', null, hostStatus === undefined
                    ? t('checkingConnection')
                    : hostStatus.lastActiveAt === undefined
                      ? t('neverConnected')
                      : t('lastActive', { time: formatLocalTime(hostStatus.lastActiveAt) }))),
                React.createElement('button', {
                  type: 'button',
                  className: 'dshRemoteReconnect',
                  disabled: reconnectBusy || hostStatus?.configured === false,
                  onClick: () => void reconnectHost(),
                }, t(reconnectBusy ? 'reconnectingAction' : 'reconnect'))),
              hostStatus?.error === undefined || hostStatus.online
                ? null
                : React.createElement('p', { className: 'dshRemoteConnectionIssue', role: 'status' }, connectionErrorMessage(hostStatus.error, t)),
              !writable ? React.createElement('p', { className: 'dshRemoteError' }, t('readOnly')) : null,
              React.createElement('div', { className: 'dshRemoteSettingsFooter' },
                React.createElement('p', {
                  className: error !== undefined ? 'dshRemoteError' : 'dshRemoteNotice',
                  role: error !== undefined ? 'alert' : 'status',
                }, error ?? (notice === undefined ? '' : t(notice.key, notice.params))),
                React.createElement('button', {
                  type: 'button',
                  className: 'dshRemoteDiscard',
                  disabled: busy || !writable,
                  onClick: () => void logout(),
                }, t(busy ? 'signingOut' : 'signOut'))))
            : React.createElement('div', { className: 'dshRemoteSettings' },
              React.createElement('div', { className: 'dshRemoteHostIdentity' },
                React.createElement('div', null,
                  React.createElement('span', null, t('hostName')),
                  React.createElement('strong', null, hostName || '—')),
                React.createElement('div', null,
                  React.createElement('span', null, t('deviceId')),
                  React.createElement('code', null, hostDeviceId || '—'))),
              developmentSetting,
              sidebarEntrySetting,
              acpSetting,
              React.createElement('div', { className: 'dshRemoteSettingsSignIn' },
                React.createElement('p', { className: 'dshRemoteSettingsState' }, t('authorizeFromRemote')),
                React.createElement('button', {
                  type: 'button',
                  className: signInOpen ? 'dshRemoteDiscard' : 'dshRemoteSave',
                  disabled: busy || !loaded,
                  'aria-expanded': signInOpen,
                  'aria-controls': 'dsh-remote-inline-signin',
                  onClick: () => {
                    setError(undefined)
                    setSignInOpen(current => !current)
                  },
                }, t(signInOpen ? 'close' : 'signInAccount'))),
              inlineSignIn,
              !writable ? React.createElement('p', { className: 'dshRemoteError' }, t('readOnly')) : null,
              error !== undefined || notice !== undefined ? React.createElement('div', { className: 'dshRemoteSettingsFooter' },
                React.createElement('p', {
                  className: error !== undefined ? 'dshRemoteError' : 'dshRemoteNotice',
                  role: error !== undefined ? 'alert' : 'status',
                }, error ?? t(notice!.key, notice!.params))) : null)))
  }

  return RemotePluginOptions
}
