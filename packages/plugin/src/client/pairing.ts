import QRCode from 'qrcode'
import type { ClientReact } from './types.js'
import type { LocaleKey, Translate } from '../client-locale.js'
import type { HostPairingView } from '../pairing-contract.js'
import { messageOf } from './presentation.js'

function errorCodeOf(reason: unknown): string | undefined {
  if (typeof reason !== 'object' || reason === null) return undefined
  const e = reason as { code?: unknown; details?: { remoteCode?: unknown } }
  if (typeof e.details?.remoteCode === 'string') return e.details.remoteCode
  return typeof e.code === 'string' ? e.code : undefined
}

function pairingErrorKey(code: string | undefined): LocaleKey {
  if (code === 'PAIRING_UNSUPPORTED') return 'pairingUnsupported'
  if (code === 'PAIRING_ACCOUNT_CONFLICT') return 'pairingAccountConflict'
  if (code === 'HOST_DEVICE_LIMIT_REACHED') return 'pairingHostDeviceLimitReached'
  if (code === 'PAIRING_DEVICE_CONFLICT') return 'pairingDeviceConflict'
  return 'pairingError'
}

function pairingFailureKey(reason: string | undefined): LocaleKey | undefined {
  if (reason === 'PAIRING_ACCOUNT_CONFLICT') return 'pairingAccountConflict'
  if (reason === 'HOST_DEVICE_LIMIT_REACHED') return 'pairingHostDeviceLimitReached'
  if (reason === 'verification_failed') return 'pairingVerificationFailed'
  if (reason === 'PAIRING_DEVICE_CONFLICT') return 'pairingDeviceConflict'
  return undefined
}

export function createHostPairingPanel(React: ClientReact) {
  return function HostPairingPanel(props: {
    control: <T>(endpoint: string, payload?: unknown) => Promise<T>
    serverUrl: string
    disabled: boolean
    mode?: 'sign-in' | 'add'
    t: Translate
    onComplete(): void | Promise<void>
    onDone?: () => void
  }): unknown {
    const { t } = props
    const addMode = props.mode === 'add'
    const [view, setView] = React.useState<HostPairingView | undefined>(undefined)
    const [image, setImage] = React.useState<string | undefined>(undefined)
    const [now, setNow] = React.useState(Date.now())
    const [code, setCode] = React.useState('')
    const [busy, setBusy] = React.useState(false)
    const [locked, setLocked] = React.useState(false)
    const [error, setError] = React.useState<string | undefined>(undefined)
    const mounted = React.useRef(false)
    const flight = React.useRef(false)
    const epoch = React.useRef(0)
    const hydratedServer = React.useRef<string | undefined>(undefined)
    const prevServerUrl = React.useRef(props.serverUrl)
    const attempts = React.useRef(new Set<string>())
    const completed = React.useRef<string | undefined>(undefined)
    const completing = React.useRef<Promise<void> | undefined>(undefined)
    const completion = React.useRef(props.onComplete)
    completion.current = props.onComplete
    const doneCallback = React.useRef(props.onDone)
    doneCallback.current = props.onDone
    const runComplete = async (): Promise<void> => {
      const pending = completing.current ?? (async () => completion.current())()
      completing.current = pending
      try {
        await pending
      } finally {
        if (completing.current === pending) completing.current = undefined
      }
    }
    const triggerComplete = async (sessionId: string): Promise<void> => {
      if (completed.current === sessionId) return
      completed.current = sessionId
      const currentEpoch = epoch.current
      try {
        await runComplete()
      } catch (reason) {
        if (completed.current === sessionId) completed.current = undefined
        if (mounted.current && currentEpoch === epoch.current) setError(messageOf(reason, t))
      }
    }
    const apply = (next: HostPairingView | undefined): void => {
      if (!mounted.current) return
      if (next && !['created', 'claimed', 'approved'].includes(next.state)) attempts.current.delete(next.sessionId)
      setView(next); setLocked(next?.canRetry === true || next !== undefined && attempts.current.has(next.sessionId))
      if (next?.localSaved) void triggerComplete(next.sessionId)
    }
    React.useEffect(() => {
      mounted.current = true
      return () => { mounted.current = false }
    }, [])
    React.useEffect(() => {
      if (prevServerUrl.current === props.serverUrl) return
      prevServerUrl.current = props.serverUrl
      hydratedServer.current = undefined
      epoch.current += 1
      completed.current = undefined
      completing.current = undefined
      attempts.current.clear()
      setView(undefined)
      setLocked(false)
      setCode('')
      setError(undefined)
    }, [props.serverUrl])
    React.useEffect(() => {
      if (props.disabled || !props.serverUrl || hydratedServer.current === props.serverUrl) return
      let cancelled = false
      const currentEpoch = epoch.current
      const hydrate = async (): Promise<void> => {
        if (flight.current) return
        try {
          const next = await props.control<HostPairingView | undefined>('host.pairing.status')
          if (cancelled || !mounted.current || currentEpoch !== epoch.current) return
          hydratedServer.current = props.serverUrl
          apply(next)
        } catch { /* foreground actions own errors */ }
      }
      void hydrate()
      return () => { cancelled = true }
    }, [props.serverUrl, props.disabled])
    const active = view !== undefined && ['created', 'claimed', 'approved'].includes(view.state)
    React.useEffect(() => {
      if (!active || props.disabled || !props.serverUrl) return
      let cancelled = false
      let timer: ReturnType<typeof setTimeout> | undefined
      const schedulePoll = (): void => {
        if (cancelled || !mounted.current) return
        timer = setTimeout(() => { void poll() }, 2500)
      }
      const poll = async (): Promise<void> => {
        if (cancelled || !mounted.current) return
        if (!flight.current) {
          const currentEpoch = epoch.current
          try {
            const next = await props.control<HostPairingView | undefined>('host.pairing.status')
            if (!cancelled && mounted.current && currentEpoch === epoch.current) apply(next)
          } catch { /* foreground actions own errors */ }
        }
        schedulePoll()
      }
      schedulePoll()
      return () => {
        cancelled = true
        if (timer !== undefined) clearTimeout(timer)
      }
    }, [active, props.serverUrl, props.disabled])
    React.useEffect(() => {
      let current = true; setImage(undefined)
      if (view?.qrPayload) void QRCode.toDataURL(view.qrPayload, { width: 184, margin: 1, errorCorrectionLevel: 'L' })
        .then(value => { if (current) setImage(value) }).catch(() => { if (current) setError(t('pairingError')) })
      return () => { current = false }
    }, [view?.qrPayload])
    const run = async (action: 'start' | 'confirm' | 'cancel', retry = false): Promise<void> => {
      if (flight.current) return
      flight.current = true
      const currentEpoch = ++epoch.current
      setBusy(true); setError(undefined)
      if (action === 'confirm') { if (view) attempts.current.add(view.sessionId); setLocked(true); setCode('') }
      try {
        const next = await props.control<HostPairingView>('host.pairing.' + action, action === 'start' ? {} : {
          sessionId: view?.sessionId, ...(action === 'confirm' && !retry ? { verificationCode: code } : {}),
        })
        if (!mounted.current || currentEpoch !== epoch.current) return
        hydratedServer.current = props.serverUrl
        apply(next)
      } catch (reason) {
        if (mounted.current && currentEpoch === epoch.current) setError(t(pairingErrorKey(errorCodeOf(reason))))
      } finally { flight.current = false; if (mounted.current) setBusy(false) }
    }
    const finish = async (): Promise<void> => {
      if (flight.current) return
      flight.current = true
      const currentEpoch = ++epoch.current
      setBusy(true); setError(undefined)
      try {
        await runComplete()
        if (!mounted.current || currentEpoch !== epoch.current) return
        completed.current = undefined
        setView(undefined)
        setLocked(false)
        setCode('')
        doneCallback.current?.()
      } catch (reason) {
        if (mounted.current && currentEpoch === epoch.current) setError(messageOf(reason, t))
      } finally {
        flight.current = false
        if (mounted.current) setBusy(false)
      }
    }
    React.useEffect(() => {
      if (!active) return
      setNow(Date.now())
      const timer = setInterval(() => setNow(Date.now()), 1000)
      return () => clearInterval(timer)
    }, [active, view?.expiresAt])
    const remaining = view === undefined ? 0 : Math.max(0, Math.ceil((new Date(view.expiresAt).getTime() - now) / 1000))
    const remainingText = `${Math.floor(remaining / 60).toString().padStart(2, '0')}:${(remaining % 60).toString().padStart(2, '0')}`
    const retry = locked || view?.canRetry || view?.state === 'approved'
    const status: LocaleKey = view === undefined ? (addMode ? 'pairingAddHint' : 'pairingHint')
      : view.state === 'created' ? (addMode ? 'pairingAddScan' : 'pairingScan')
        : view.state === 'claimed' ? 'pairingEnter'
          : view.state === 'completed' ? (addMode ? 'pairingAddComplete' : 'pairingComplete')
            : view.state === 'approved' ? 'pairingPending' : 'pairingClosed'
    const failureKey = view?.state === 'failed' ? pairingFailureKey(view.failureReason) : undefined
    const alertMessage = error ?? (failureKey === undefined ? undefined : t(failureKey))
    const instructionLines = t(status).split('\n')
    const countdown = !active ? null : React.createElement('span', { className: 'dshRemotePairingCountdown', role: 'timer' }, remaining > 0 ? t('pairingExpires', { time: remainingText }) : t('pairingExpired'))
    return React.createElement('section', { className: 'dshRemotePairing', 'aria-label': t(addMode ? 'pairingAddTitle' : 'pairingTitle') },
      React.createElement('div', { className: 'dshRemotePairingHeading' },
      React.createElement('p', { role: 'status', 'aria-live': 'polite', className: 'dshRemotePairingInstructions' }, ...instructionLines.flatMap((line, lineIndex) => [React.createElement('span', { key: lineIndex, className: lineIndex === 0 ? 'dshRemotePairingInstructionPrimary' : 'dshRemotePairingInstructionSecondary' }, ...line.split('DSH Go').flatMap((part, index) => index === 0 ? [part] : [React.createElement('a', { key: index, href: 'https://github.com/ccch1mneyyy/dsh-go', target: '_blank', rel: 'noopener noreferrer' }, 'DSH Go'), part])), lineIndex < instructionLines.length - 1 ? React.createElement('br', { key: `break-${lineIndex}` }) : null])),
        active && view?.state !== 'created' ? countdown : null),
      props.disabled ? React.createElement('p', null, t('pairingSaveServer')) : null,
      image === undefined ? null : React.createElement('img', { src: image, width: 200, height: 200, alt: t('pairingQr'), className: 'dshRemotePairingQr' }),
      view?.state !== 'created' ? null : React.createElement('div', { className: 'dshRemotePairingQrActions' },
        countdown,
        React.createElement('button', { type: 'button', className: 'dshRemoteDiscard', disabled: busy || props.disabled,
          onClick: () => void run('cancel') }, t(busy ? 'pairingBusy' : 'pairingCancel'))),
      view?.mobile === undefined ? null : React.createElement('p', { className: 'dshRemotePairingIdentity' }, React.createElement('strong', null, view.mobile.name), React.createElement('br'), React.createElement('code', null, view.mobile.fingerprint)),
      view?.state !== 'claimed' || retry ? null : React.createElement('form', { className: 'dshRemotePairingCodeForm', onSubmit: (event: { preventDefault(): void; nativeEvent?: Event }) => {
        event.preventDefault()
        // Reject synthetic dispatch; this is not a claim of protection from OS automation.
        if (event.nativeEvent?.isTrusted && /^[0-9]{8}$/.test(code)) void run('confirm')
      } }, React.createElement('label', null, t('pairingCode'), React.createElement('input', {
        type: 'text', inputMode: 'numeric', autoComplete: 'off', pattern: '[0-9]{8}', maxLength: 8, value: code, disabled: busy,
        onChange: (event: Event) => setCode((event.target as HTMLInputElement).value.replace(/[^0-9]/g, '').slice(0, 8)),
      })), React.createElement('p', { className: 'dshRemotePairingCodeWarning' }, t('pairingWarning')),
      React.createElement('div', { className: 'dshRemotePairingCodeActions' }, React.createElement('button', { type: 'submit', className: 'dshRemoteSave', disabled: busy || props.disabled || !/^[0-9]{8}$/.test(code) }, t('pairingConfirm')), React.createElement('button', { type: 'button', className: 'dshRemoteDiscard', disabled: busy || props.disabled, onClick: () => void run('cancel') }, t('pairingCancel')))),
      alertMessage === undefined ? null : React.createElement('p', { role: 'alert', className: 'dshRemoteError' }, alertMessage),
      React.createElement('div', { className: 'dshRemotePairingActions' },
        active && retry ? React.createElement('button', { type: 'button', disabled: busy || props.disabled, className: 'dshRemoteSave',
          onClick: (event: { nativeEvent?: Event }) => { if (event.nativeEvent?.isTrusted) void run('confirm', true) } }, t('pairingRetry')) : null,
        active && retry ? React.createElement('button', { type: 'button', className: 'dshRemoteDiscard', disabled: busy || props.disabled, onClick: () => void run('cancel') }, t('pairingCancel')) : null,
        view?.state === 'completed' ? React.createElement('button', { type: 'button', className: 'dshRemoteSave', disabled: busy || props.disabled,
          onClick: () => void finish() }, t(busy ? 'pairingBusy' : 'pairingDone')) : null,
        active || view?.state === 'completed' ? null : React.createElement('button', { type: 'button', className: 'dshRemoteSave', disabled: busy || props.disabled || !props.serverUrl,
          onClick: () => void run(active ? 'cancel' : 'start') }, t(busy ? 'pairingBusy' : active ? 'pairingCancel' : 'pairingStart'))))
  }
}
