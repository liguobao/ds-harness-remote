export interface PageWindow {
  start: number
  end: number
}

export interface PageSlotOffset {
  readonly top: number
}

export function computeActivePageWindow(currentPage: number, totalPages: number, zoom: number): PageWindow
export function findPageAtScrollOffset(targetY: number, slots: readonly PageSlotOffset[]): number
