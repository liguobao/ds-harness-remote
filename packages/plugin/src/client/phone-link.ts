import QRCode from 'qrcode'
import type { Translate } from '../client-locale.js'
import type { ClientReact } from './types.js'

/** Remote Web page that opens this Host directly; it carries no credential. */
export function remoteWebHostUrl(serverUrl: string, deviceId: string): string {
  return `${serverUrl.replace(/\/+$/, '')}/app/remote/${encodeURIComponent(deviceId)}`
}

/** Header action that shows a QR code for opening this Host from a phone browser. */
export function createPhoneLinkMenu(React: ClientReact) {
  return function PhoneLinkMenu(props: { serverUrl: string; deviceId: string; t: Translate }): unknown {
    const { t } = props
    const [open, setOpen] = React.useState(false)
    const [image, setImage] = React.useState<string | undefined>(undefined)
    const url = remoteWebHostUrl(props.serverUrl, props.deviceId)

    React.useEffect(() => {
      let current = true
      setImage(undefined)
      if (open) {
        void QRCode.toDataURL(url, { width: 184, margin: 1, errorCorrectionLevel: 'M' })
          .then(value => { if (current) setImage(value) })
          .catch(() => undefined)
      }
      return () => { current = false }
    }, [open, url])

    React.useEffect(() => {
      if (!open) return
      const closeOnPointer = (event: MouseEvent): void => {
        const target = event.target
        if (target instanceof Element && target.closest('.dshRemotePhoneLink') !== null) return
        setOpen(false)
      }
      // Capture phase on window runs before the dialog's own Escape handler,
      // so Escape closes only this panel and leaves the Remote dialog open.
      const closeOnEscape = (event: KeyboardEvent): void => {
        if (event.key !== 'Escape') return
        event.stopPropagation()
        setOpen(false)
      }
      window.addEventListener('mousedown', closeOnPointer)
      window.addEventListener('keydown', closeOnEscape, true)
      return () => {
        window.removeEventListener('mousedown', closeOnPointer)
        window.removeEventListener('keydown', closeOnEscape, true)
      }
    }, [open])

    const label = t('openOnPhone')
    return React.createElement('div', { className: `dshRemotePhoneLink${open ? ' isOpen' : ''}` },
      React.createElement('button', {
        type: 'button',
        className: 'dshRemotePhoneLinkButton',
        title: label,
        'aria-label': label,
        'aria-expanded': open,
        'aria-haspopup': 'dialog',
        onClick: () => setOpen(current => !current),
      }, React.createElement('svg', {
        viewBox: '0 0 24 24', width: 16, height: 16, fill: 'none', stroke: 'currentColor',
        strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true,
      },
      React.createElement('rect', { x: 6, y: 2.5, width: 12, height: 19, rx: 2.5 }),
      React.createElement('path', { d: 'M11 18h2' }))),
      open
        ? React.createElement('div', { className: 'dshRemotePhoneLinkPanel', role: 'dialog', 'aria-label': label },
          React.createElement('strong', { className: 'dshRemotePhoneLinkTitle' }, label),
          React.createElement('p', { className: 'dshRemotePhoneLinkHint' }, t('openOnPhoneHint')),
          image === undefined
            ? React.createElement('div', { className: 'dshRemotePhoneLinkQr', 'aria-busy': true })
            : React.createElement('img', { src: image, width: 184, height: 184, alt: t('openOnPhoneQr'), className: 'dshRemotePhoneLinkQr' }),
          React.createElement('a', { className: 'dshRemotePhoneLinkUrl', href: url, target: '_blank', rel: 'noreferrer' }, url))
        : null)
  }
}
