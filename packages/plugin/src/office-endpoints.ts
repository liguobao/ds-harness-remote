/**
 * DSH 0.2.2-alpha.3 moved the Office conversion provider from
 * `@deepseek-ai/dsh-office-to-pdf` to `@deepseek-ai/dsh-office-kit` and renamed
 * its Remote methods with it: `officeToPdf/render` became `officeKit/render`.
 * The names are not interchangeable at the native Gateway — a release registers
 * one family and rejects the other as an unknown endpoint — so the Remote host
 * accepts both and forwards whichever name the connected client used.
 */
export const OFFICE_RENDER_ENDPOINTS: ReadonlySet<string> = new Set([
  'officeToPdf/render',
  'officeKit/render',
])

export function isOfficeRenderEndpoint(endpoint: string): boolean {
  return OFFICE_RENDER_ENDPOINTS.has(endpoint)
}

/**
 * Endpoints whose native result carries raw `data` bytes. The JSON-only Remote
 * carrier has to re-encode these on the Host and decode them on the client.
 */
export function isWorkspaceBinaryEndpoint(endpoint: string): boolean {
  return endpoint === 'workspaceFiles/readBytes' || isOfficeRenderEndpoint(endpoint)
}
