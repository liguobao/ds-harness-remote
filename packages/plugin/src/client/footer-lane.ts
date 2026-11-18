/**
 * Footer action capacity contract shared by every `sidebar.footer.action`
 * occupant.
 *
 * The sidebar footer is a single flex row owned by the host. Several plugins
 * seat their own button there, and the host gives an occupant neither a row gap
 * nor its peer count: each plugin has to derive its own form from the same
 * stable inputs, or neighbours end up measuring each other and oscillate
 * (A expands -> B narrows -> B shrinks -> A expands again).
 *
 * The contract therefore only takes "occupant count" and "row width", both of
 * which are observable without reading a peer's chosen form, and it is
 * all-or-nothing: when the row cannot hold one labelled seat per occupant every
 * occupant renders the icon form. Two forms exist, matching the host's own
 * sidebar geometry -- a 42px label row and a 36x36 icon target, both using the
 * host's 12px radius and inline paint inset.
 */

/** Icon-form target, identical to the host's rail controls (36x36, 12px radius). */
export const FOOTER_ICON_WIDTH = 36

/** Capacity estimate for one labelled seat; not a style constraint. */
export const FOOTER_MAX_LABEL_BOX = 112

/** More than this many occupants in one row always render the icon form. */
export const FOOTER_COUNT_LIMIT = 2

/** Visual gap between two neighbours: both sides contribute a 2px inline margin. */
export const FOOTER_ROW_GAP = 4

/** Host row furniture (sidebar inline padding on both sides). */
export const FOOTER_ROW_PADDING = 16

export type FooterForm = 'label' | 'icon'

/** Facts measured from the real footer row; `row` stays null when there is no row. */
export interface FooterSeatFacts {
  row: Element | null
  /** The row lays its occupants out horizontally. */
  lane: boolean
  /** The row currently wraps, so every occupant may occupy a full line. */
  wrapped: boolean
  /** Occupants sharing the lane, including this button; 0 while no lane was found. */
  count: number
  /** Row content width; NaN when it could not be measured. */
  rowWidth: number
}

/** Minimal computed-style surface, injected so tests can supply a fake view. */
export interface FooterSeatView {
  getComputedStyle(element: Element): {
    readonly display: string
    readonly flexDirection: string
    readonly flexWrap: string
    readonly position: string
  }
}

const NO_FACTS: FooterSeatFacts = { row: null, lane: false, wrapped: false, count: 0, rowWidth: Number.NaN }

/** Width one row needs to keep the label form for `count` occupants. */
export function footerRequiredWidth(count: number): number {
  if (count <= 0) return 0
  return count * FOOTER_MAX_LABEL_BOX + (count - 1) * FOOTER_ROW_GAP + FOOTER_ROW_PADDING
}

/**
 * Resolve the form from stable inputs only.
 *
 * `count > FOOTER_COUNT_LIMIT` is an icon regardless of width; a width that
 * could not be measured resolves to the compact icon form rather than the
 * overflowing label form (the text stays in `title` / `aria-label`).
 */
export function resolveFooterForm(count: number, rowWidth: number): FooterForm {
  if (count <= 0) return 'label'
  if (count > FOOTER_COUNT_LIMIT) return 'icon'
  if (!Number.isFinite(rowWidth)) return 'icon'
  return rowWidth >= footerRequiredWidth(count) ? 'label' : 'icon'
}

/** An entry occupies lane space unless it is an overlay or renders at zero size. */
export function occupiesFooterSeat(entry: { position?: string; width?: number; height?: number } | null | undefined): boolean {
  if (entry === null || entry === undefined) return false
  if (entry.position === 'fixed' || entry.position === 'absolute') return false
  return (entry.width ?? 0) > 0 && (entry.height ?? 0) > 0
}

/**
 * Measure the facts of the flex row that contains `entry`.
 *
 * The entry is the anchor: the slot outlet is a `display: contents` shell with
 * no box of its own, so the walk climbs until it finds a laid-out box, and lane
 * entries are collected through the same expansion. A single-child plain wrapper
 * is not the row either. This function reads layout only; it never mutates the
 * host DOM (injecting `flex-wrap` here would push the settings row down).
 */
export function measureFooterSeat(entry: Element | null | undefined, view: FooterSeatView | undefined = globalThis as unknown as FooterSeatView): FooterSeatFacts {
  const styleOf = view !== undefined && typeof view.getComputedStyle === 'function' ? view.getComputedStyle.bind(view) : null
  if (entry === null || entry === undefined || styleOf === null) return { ...NO_FACTS }
  let node: Element | null = entry
  while (node !== null && node.parentElement != null) {
    const row: Element = node.parentElement
    const style = styleOf(row)
    if (style.display === 'contents') { node = row; continue }
    if (style.display !== 'flex' && style.display !== 'inline-flex') {
      if (row.children.length === 1) { node = row; continue }
      return { ...NO_FACTS }
    }
    const facts: FooterSeatFacts = {
      row,
      lane: style.flexDirection.startsWith('row'),
      wrapped: style.flexWrap !== 'nowrap',
      count: 1,
      rowWidth: (row as HTMLElement).clientWidth,
    }
    if (!facts.lane) return facts
    const collect = (container: Element): void => {
      for (const child of Array.from(container.children)) {
        const childStyle = styleOf(child)
        if (childStyle.display === 'contents') { collect(child); continue }
        if (child.contains(entry)) continue
        const rect = typeof child.getBoundingClientRect === 'function' ? child.getBoundingClientRect() : { width: 0, height: 0 }
        if (!occupiesFooterSeat({ position: childStyle.position, width: rect.width, height: rect.height })) continue
        facts.count += 1
      }
    }
    collect(row)
    return facts
  }
  return { ...NO_FACTS }
}

/**
 * Map measured facts to one of the two forms.
 *
 * The rail (collapsed sidebar) is always the icon target. A host row that turned
 * vertical or wraps is a container shape, not a capacity decision: the label form
 * keeps the occupant on its own full line. Otherwise the shared capacity rule
 * decides, so every occupant of the row reaches the same answer independently.
 */
export function footerFormFor(facts: FooterSeatFacts, wide: boolean): FooterForm {
  if (!wide) return 'icon'
  if (facts.row === null) return 'label'
  if (!facts.lane || facts.wrapped) return 'label'
  return resolveFooterForm(facts.count, facts.rowWidth)
}

/**
 * Keep one entry's form in sync with the live footer row.
 *
 * `ResizeObserver` follows the row width and the entry itself, `MutationObserver`
 * follows neighbours mounting or leaving (both are attributed to the row's
 * subtree, which is the only signal an occupant gets), and `window resize`
 * covers the sidebar being dragged. The callback fires only when the resolved
 * form changes, so a re-render cannot feed itself.
 */
export function watchFooterLane(entry: Element, wide: () => boolean, onForm: (form: FooterForm) => void, view: FooterSeatView | undefined = globalThis as unknown as FooterSeatView): () => void {
  let reported: FooterForm | undefined
  let row: Element | null = null
  let resize: ResizeObserver | undefined
  let mutation: MutationObserver | undefined
  const resolve = (): void => {
    const next = footerFormFor(measureFooterSeat(entry, view), wide())
    if (next === reported) return
    reported = next
    onForm(next)
  }
  const bind = (): void => {
    const next = measureFooterSeat(entry, view).row
    if (next === row) return
    resize?.disconnect()
    mutation?.disconnect()
    resize = undefined
    mutation = undefined
    row = next
    if (row === null) return
    if (typeof ResizeObserver === 'function') {
      resize = new ResizeObserver(() => { resolve(); bind() })
      resize.observe(row)
      resize.observe(entry)
    }
    if (typeof MutationObserver === 'function') {
      mutation = new MutationObserver(() => { resolve(); bind() })
      mutation.observe(row, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class', 'hidden'] })
    }
  }
  const onViewportResize = (): void => { resolve(); bind() }
  resolve()
  bind()
  if (typeof window !== 'undefined') window.addEventListener('resize', onViewportResize)
  return () => {
    resize?.disconnect()
    mutation?.disconnect()
    if (typeof window !== 'undefined') window.removeEventListener('resize', onViewportResize)
  }
}
