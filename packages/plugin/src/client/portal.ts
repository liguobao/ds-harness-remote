import type { PortalRenderer } from './types.js'

/** Escape shell ancestors that establish a fixed-position containing block. */
export function renderBodyPortal(portal: PortalRenderer | undefined, children: unknown): unknown {
  if (portal === undefined || typeof document === 'undefined' || document.body === null) return children
  return portal(children, document.body)
}
