;(function (root) {
  function computeActivePageWindow(currentPage, totalPages, zoom) {
    if (!Number.isFinite(totalPages) || totalPages < 1) {
      return { start: 1, end: 1 }
    }
    const pages = Math.floor(totalPages)
    const clamped = Math.min(Math.max(1, Math.floor(currentPage) || 1), pages)
    const behind = 1
    const ahead = zoom > 1.5 ? 1 : 2
    return {
      start: Math.max(1, clamped - behind),
      end: Math.min(pages, clamped + ahead),
    }
  }

  function findPageAtScrollOffset(targetY, slots) {
    if (!Array.isArray(slots) || slots.length === 0) return 1
    if (targetY <= slots[0].top) return 1

    let low = 0
    let high = slots.length - 1
    let answer = 0
    while (low <= high) {
      const mid = (low + high) >>> 1
      if (slots[mid].top <= targetY) {
        answer = mid
        low = mid + 1
      } else {
        high = mid - 1
      }
    }
    return answer + 1
  }

  const api = { computeActivePageWindow, findPageAtScrollOffset }
  if (typeof module === 'object' && module.exports) {
    module.exports = api
  } else {
    root.__dshPdfViewportMath = api
  }
})(typeof globalThis !== 'undefined' ? globalThis : window)
