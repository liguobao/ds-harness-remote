import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderBodyPortal } from '../src/client/portal.js'

const body = { tagName: 'BODY' } as unknown as Element
const child = { type: 'div' }

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('renderBodyPortal', () => {
  it('portals into document.body so fixed layers escape the host containing block', () => {
    vi.stubGlobal('document', { body })
    const portal = vi.fn((_children: unknown, _container: Element) => ({ portalled: true }))
    expect(renderBodyPortal(portal, child)).toEqual({ portalled: true })
    expect(portal).toHaveBeenCalledWith(child, body)
  })

  it('renders inline when the host exposes no portal renderer', () => {
    vi.stubGlobal('document', { body })
    expect(renderBodyPortal(undefined, child)).toBe(child)
  })

  it('renders inline when the renderer is not a function', () => {
    vi.stubGlobal('document', { body })
    expect(renderBodyPortal(null as unknown as undefined, child)).toBe(child)
    expect(renderBodyPortal({} as unknown as undefined, child)).toBe(child)
    expect(renderBodyPortal('createPortal' as unknown as undefined, child)).toBe(child)
  })

  it('renders inline during server-side rendering, where document is absent', () => {
    expect(typeof document).toBe('undefined')
    const portal = vi.fn()
    expect(renderBodyPortal(portal, child)).toBe(child)
    expect(portal).not.toHaveBeenCalled()
  })

  it('renders inline before document.body exists', () => {
    vi.stubGlobal('document', { body: null })
    const portal = vi.fn()
    expect(renderBodyPortal(portal, child)).toBe(child)
    expect(portal).not.toHaveBeenCalled()
  })

  it('renders inline instead of throwing when createPortal rejects the container', () => {
    vi.stubGlobal('document', { body })
    const portal = vi.fn(() => { throw new Error('Target container is not a DOM element.') })
    expect(() => renderBodyPortal(portal, child)).not.toThrow()
    expect(renderBodyPortal(portal, child)).toBe(child)
  })
})
