import type { Translate } from '../client-locale.js'
import type { ClientReact } from './types.js'

export function useAccountVerification(React: ClientReact, scope: unknown) {
  const [pending, setPending] = React.useState<{ challenge: string; serverUrl: string } | undefined>(undefined)
  const [code, setCode] = React.useState('')
  const clear = () => {
    setPending(undefined)
    setCode('')
  }
  React.useEffect(clear, [scope])

  return {
    pending: pending !== undefined,
    ready: pending === undefined || code.trim().length > 0,
    verification: pending === undefined ? undefined : { ...pending, code },
    clear,
    handle(error: unknown): boolean {
      const failure = error as { code?: string; details?: { challenge?: unknown; serverUrl?: unknown } } | undefined
      if (failure?.code === 'TWO_FACTOR_EXPIRED') clear()
      if (failure?.code !== 'TWO_FACTOR_REQUIRED'
        || typeof failure.details?.challenge !== 'string' || typeof failure.details.serverUrl !== 'string') return false
      setPending({ challenge: failure.details.challenge, serverUrl: failure.details.serverUrl })
      setCode('')
      return true
    },
    fields(t: Translate, busy: boolean, ...passwordFields: unknown[]): unknown {
      if (pending === undefined) return React.createElement(React.Fragment, null, ...passwordFields)
      return React.createElement(React.Fragment, null,
        React.createElement('input', {
          value: code, disabled: busy, autoComplete: 'one-time-code', maxLength: 64,
          placeholder: t('twoFactorCode'), 'aria-label': t('twoFactorCode'),
          onChange: (event: Event) => setCode((event.target as HTMLInputElement).value),
        }),
        React.createElement('button', { type: 'button', disabled: busy, onClick: clear }, t('twoFactorRestart')),
      )
    },
  }
}
