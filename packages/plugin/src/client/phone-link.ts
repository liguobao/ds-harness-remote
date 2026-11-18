import QRCode from 'qrcode'
import type { Translate } from '../client-locale.js'
import type { ClientReact } from './types.js'

/** Remote Web page that opens this Host directly; it carries no credential. */
export function remoteWebHostUrl(serverUrl: string, deviceId: string): string {
  return `${serverUrl.replace(/\/+$/, '')}/app/remote/${encodeURIComponent(deviceId)}`
}

/**
 * Host-row action that shows a QR code for opening this Host from a phone
 * browser. The panel renders inline below the row, so the Remote dialog grows
 * instead of clipping a floating layer at its edge.
 */
export function createPhoneLink(React: ClientReact) {
  function PhoneLinkButton(props: { open: boolean; onToggle(): void; t: Translate }): unknown {
    const label = props.t('openOnPhone')
    return React.createElement('button', {
      type: 'button',
      className: `dshRemotePhoneLinkButton${props.open ? ' isOpen' : ''}`,
      title: label,
      'aria-label': label,
      'aria-expanded': props.open,
      'aria-controls': 'dsh-remote-phone-link',
      onClick: props.onToggle,
    }, React.createElement('svg', {
      viewBox: '0 0 24 24', width: 16, height: 16, fill: 'none', stroke: 'currentColor',
      strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true,
    },
    React.createElement('rect', { x: 6, y: 2.5, width: 12, height: 19, rx: 2.5 }),
    React.createElement('path', { d: 'M11 18h2' })))
  }

  function PhoneLinkPanel(props: { serverUrl: string; deviceId: string; onClose(): void; t: Translate }): unknown {
    const { t } = props
    const [image, setImage] = React.useState<string | undefined>(undefined)
    const url = remoteWebHostUrl(props.serverUrl, props.deviceId)
    const close = React.useRef(props.onClose)
    close.current = props.onClose

    React.useEffect(() => {
      let current = true
      setImage(undefined)
      void QRCode.toDataURL(url, { width: 184, margin: 1, errorCorrectionLevel: 'M' })
        .then(value => { if (current) setImage(value) })
        .catch(() => undefined)
      return () => { current = false }
    }, [url])

    React.useEffect(() => {
      // Capture phase on window runs before the dialog's own Escape handler,
      // so Escape closes only this panel and leaves the Remote dialog open.
      const closeOnEscape = (event: KeyboardEvent): void => {
        if (event.key !== 'Escape') return
        event.stopPropagation()
        close.current()
      }
      window.addEventListener('keydown', closeOnEscape, true)
      return () => window.removeEventListener('keydown', closeOnEscape, true)
    }, [])

    return React.createElement('section', { className: 'dshRemotePhoneLinkPanel', id: 'dsh-remote-phone-link', 'aria-label': t('openOnPhone') },
      image === undefined
        ? React.createElement('div', { className: 'dshRemotePhoneLinkQr', 'aria-busy': true })
        : React.createElement('img', { src: image, width: 160, height: 160, alt: t('openOnPhoneQr'), className: 'dshRemotePhoneLinkQr' }),
      React.createElement('div', { className: 'dshRemotePhoneLinkText' },
        React.createElement('strong', null, t('openOnPhone')),
        React.createElement('p', null, t('openOnPhoneHint')),
        React.createElement('a', { className: 'dshRemotePhoneLinkUrl', href: url, target: '_blank', rel: 'noreferrer' }, url)))
  }

  return { PhoneLinkButton, PhoneLinkPanel }
}
