import QRCode from 'qrcode'
import type { ClientReact } from './types.js'
import type { Translate } from '../client-locale.js'
import type { HostPairingView } from '../pairing-contract.js'

export function createHostPairingPanel(React: ClientReact) {
  return function HostPairingPanel(props: {
    control: <T>(endpoint: string, payload?: unknown) => Promise<T>
    serverUrl: string; disabled: boolean; t: Translate; onComplete(): void
  }): unknown {
    const { t } = props
    const [view, setView] = React.useState<HostPairingView | undefined>(undefined)
    const [image, setImage] = React.useState<string | undefined>(undefined)
    const [code, setCode] = React.useState('')
    const [busy, setBusy] = React.useState(false)
    const [locked, setLocked] = React.useState(false)
    const [error, setError] = React.useState<string | undefined>(undefined)
    const mounted = React.useRef(false)
    const flight = React.useRef(false)
    const attempts = React.useRef(new Set<string>())
    const completed = React.useRef<string | undefined>(undefined)
    const completion = React.useRef(props.onComplete)
    completion.current = props.onComplete
    const apply = (next: HostPairingView | undefined): void => {
      if (!mounted.current) return
      if (next && !['created', 'claimed', 'approved'].includes(next.state)) attempts.current.delete(next.sessionId)
      setView(next); setLocked(next?.canRetry === true || next !== undefined && attempts.current.has(next.sessionId))
      if (next?.localSaved && completed.current !== next.sessionId) { completed.current = next.sessionId; completion.current() }
    }
    React.useEffect(() => {
      mounted.current = true
      let timer: ReturnType<typeof setTimeout> | undefined
      const poll = async (): Promise<void> => {
        if (!flight.current && !props.disabled && props.serverUrl) {
          try { apply(await props.control<HostPairingView | undefined>('host.pairing.status')) } catch { /* foreground actions own errors */ }
        }
        if (mounted.current) timer = setTimeout(() => void poll(), 2500)
      }
      void poll()
      return () => { mounted.current = false; if (timer) clearTimeout(timer) }
    }, [props.serverUrl, props.disabled])
    React.useEffect(() => {
      let current = true; setImage(undefined)
      if (view?.qrPayload) void QRCode.toDataURL(view.qrPayload, { width: 320, margin: 4, errorCorrectionLevel: 'M' })
        .then(value => { if (current) setImage(value) }).catch(() => { if (current) setError(t('pairingError')) })
      return () => { current = false }
    }, [view?.qrPayload])
    const run = async (action: 'start' | 'confirm' | 'cancel', retry = false): Promise<void> => {
      if (flight.current) return
      flight.current = true; setBusy(true); setError(undefined)
      if (action === 'confirm') { if (view) attempts.current.add(view.sessionId); setLocked(true); setCode('') }
      try { apply(await props.control<HostPairingView>('host.pairing.' + action, action === 'start' ? {} : {
        sessionId: view?.sessionId, ...(action === 'confirm' && !retry ? { verificationCode: code } : {}),
      })) } catch (reason) {
        if (mounted.current) { const e = reason as { code?: string; details?: { remoteCode?: string } }
          setError(t(e.code === 'PAIRING_UNSUPPORTED' || e.details?.remoteCode === 'PAIRING_UNSUPPORTED' ? 'pairingUnsupported' : 'pairingError')) }
      } finally { flight.current = false; if (mounted.current) setBusy(false) }
    }
    const active = view !== undefined && ['created', 'claimed', 'approved'].includes(view.state)
    const retry = locked || view?.canRetry || view?.state === 'approved'
    const status = view === undefined ? 'pairingHint' : view.state === 'created' ? 'pairingScan'
      : view.state === 'claimed' ? 'pairingEnter' : view.state === 'completed' ? 'pairingComplete'
        : view.state === 'approved' ? 'pairingPending' : 'pairingClosed'
    return React.createElement('section', { className: 'dshRemotePairing', 'aria-label': t('pairingTitle') },
      React.createElement('h3', null, t('pairingTitle')),
      React.createElement('p', { role: 'status', 'aria-live': 'polite' }, t(status)),
      React.createElement('p', null, t('pairingHostOnly')),
      props.disabled ? React.createElement('p', null, t('pairingSaveServer')) : null,
      view === undefined ? null : React.createElement('p', { className: 'dshRemotePairingIdentity' }, view.serverUrl, React.createElement('br'), React.createElement('code', null, view.hostFingerprint)),
      image === undefined ? null : React.createElement('img', { src: image, width: 320, height: 320, alt: t('pairingQr'), className: 'dshRemotePairingQr' }),
      view?.mobile === undefined ? null : React.createElement('p', { className: 'dshRemotePairingIdentity' }, React.createElement('strong', null, view.mobile.name), React.createElement('br'), React.createElement('code', null, view.mobile.fingerprint)),
      !active ? null : React.createElement('p', null, t('pairingExpires', { time: new Date(view!.expiresAt).toLocaleTimeString() })),
      view?.state !== 'claimed' || retry ? null : React.createElement('form', { onSubmit: (event: { preventDefault(): void; nativeEvent?: Event }) => {
        event.preventDefault()
        // Reject synthetic dispatch; this is not a claim of protection from OS automation.
        if (event.nativeEvent?.isTrusted && /^[0-9]{8}$/.test(code)) void run('confirm')
      } }, React.createElement('label', null, t('pairingCode'), React.createElement('input', {
        type: 'text', inputMode: 'numeric', autoComplete: 'off', pattern: '[0-9]{8}', maxLength: 8, value: code, disabled: busy,
        onChange: (event: Event) => setCode((event.target as HTMLInputElement).value.replace(/[^0-9]/g, '').slice(0, 8)),
      })), React.createElement('p', null, React.createElement('strong', null, t('pairingWarning'))),
      React.createElement('button', { type: 'submit', className: 'dshRemoteSave', disabled: busy || props.disabled || !/^[0-9]{8}$/.test(code) }, t('pairingConfirm'))),
      error === undefined ? null : React.createElement('p', { role: 'alert', className: 'dshRemoteError' }, error),
      React.createElement('div', { className: 'dshRemotePairingActions' },
        active && retry ? React.createElement('button', { type: 'button', disabled: busy || props.disabled, className: 'dshRemoteSave',
          onClick: (event: { nativeEvent?: Event }) => { if (event.nativeEvent?.isTrusted) void run('confirm', true) } }, t('pairingRetry')) : null,
        React.createElement('button', { type: 'button', className: active ? 'dshRemoteDiscard' : 'dshRemoteSave', disabled: busy || props.disabled || !props.serverUrl,
          onClick: () => void run(active ? 'cancel' : 'start') }, t(busy ? 'pairingBusy' : active ? 'pairingCancel' : 'pairingStart'))))
  }
}
