// Inlined after the bundled pdf.js module by scripts/build-pdf.mjs. pdf.js resolves its worker
// through globalThis.pdfjsWorker, which the bundled worker module installs, so the worker runs on
// the main thread and this page spawns no Worker, fetches nothing and touches no file.
;(() => {
  const MAX_BASE64_CHARS = Math.ceil((16 * 1024 * 1024) / 3) * 4
  const MAX_CANVAS_PIXELS = 4_000_000
  const MAX_TOTAL_CANVAS_PIXELS = 12_000_000
  const MAX_CANVAS_DIMENSION = 8192
  const MAX_RATIO = 2
  const MAX_TEXT_ITEMS = 5000
  const MIN_ZOOM = 1
  const MAX_ZOOM = 4
  /** Must match PAGE_MARGIN and PAGE_GAP in scripts/build-pdf.mjs. */
  const PAGE_MARGIN = 12
  const PAGE_GAP = 12
  const THUMB_MAX_DIM = 160
  const THUMB_MAX_DATA_URL = 65_536
  const MAX_THUMB_QUEUE = 24
  const { computeActivePageWindow, findPageAtScrollOffset } = globalThis.__dshPdfViewportMath
  const RESIZE_DEBOUNCE_MS = 120
  const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/

  if (typeof getDocument !== 'function' || typeof globalThis.pdfjsWorker?.WorkerMessageHandler?.setup !== 'function') {
    throw new Error('The bundled pdf.js module is incomplete.')
  }

  const rootEl = document.getElementById('pdf-root')
  const stackEl = document.getElementById('pdf-stack')

  const state = { status: 'idle', page: 0, pages: 0, zoom: 1, scale: 0, error: null }
  window.pdfState = state

  let session = null
  let chunks = []
  let chunkLength = 0
  let beginToken = 0
  let loadToken = 0
  let renderGen = 0
  let loadingTask = null
  let doc = null
  let pageCount = 0
  let currentPage = 1
  let zoom = 1
  let topPaddingPx = 12
  let slots = []
  let thumbQueue = []
  const thumbInQueue = new Set()
  const thumbCanvas = document.createElement('canvas')
  let activeRender = null
  let pumping = false
  let pumpRequested = false
  let sentRendered = false
  let scrolling = false
  let scrollIdleTimer = 0
  let scrollRaf = 0
  let programmaticLock = false
  let programmaticTimer = 0
  let resizeTimer = 0
  let lastWidth = 0
  let disposed = false
  let pinch = null
  let lastTap = null
  let singleTapCandidate = null

  const clamp = (value, min, max) => Math.min(Math.max(value, min), max)
  const nextFrame = () => new Promise(resolve => requestAnimationFrame(resolve))
  const send = value => {
    try { window.ReactNativeWebView.postMessage(JSON.stringify(value)) } catch { /* No bridge outside the app. */ }
  }
  const errorCode = error => {
    const name = error?.name
    if (name === 'PasswordException') return 'password'
    if (name === 'InvalidPDFException') return 'invalid'
    return 'failed'
  }
  const dropChunks = () => {
    chunks = []
    chunkLength = 0
  }
  const abortTask = async () => {
    const task = loadingTask
    loadingTask = null
    if (task === null) return
    try { await task.destroy() } catch { /* Already settled or destroyed. */ }
  }
  const fail = code => {
    void abortTask()
    dropChunks()
    state.status = 'error'
    state.error = code
    send({ type: 'error', code, id: session })
  }

  const cancelActiveRender = async () => {
    const task = activeRender
    activeRender = null
    if (task === null) return
    try { task.cancel() } catch { /* Already settled. */ }
    try { await task.promise } catch { /* Cancellation handled by owner. */ }
  }

  const releaseSlot = slot => {
    if (slot.canvas !== null) {
      slot.canvas.width = 0
      slot.canvas.height = 0
      slot.canvas.remove()
      slot.canvas = null
    }
    if (slot.textEl !== null) {
      slot.textEl.replaceChildren()
      slot.textEl.remove()
      slot.textEl = null
    }
    slot.renderedScale = 0
    if (slot.pageProxy !== null) {
      try { slot.pageProxy.cleanup() } catch { /* Document already destroyed. */ }
      slot.pageProxy = null
    }
  }

  const clearSlots = () => {
    for (const slot of slots) releaseSlot(slot)
    slots = []
    stackEl.replaceChildren()
    thumbQueue = []
    thumbInQueue.clear()
    thumbCanvas.width = 0
    thumbCanvas.height = 0
  }

  const clearPinch = () => {
    pinch = null
    stackEl.style.willChange = ''
    stackEl.style.transform = ''
    stackEl.style.transformOrigin = ''
  }

  const reset = async () => {
    renderGen += 1
    loadToken += 1
    session = null
    sentRendered = false
    pumpRequested = false
    clearPinch()
    dropChunks()
    if (scrollIdleTimer !== 0) { clearTimeout(scrollIdleTimer); scrollIdleTimer = 0 }
    if (scrollRaf !== 0) { cancelAnimationFrame(scrollRaf); scrollRaf = 0 }
    if (programmaticTimer !== 0) { clearTimeout(programmaticTimer); programmaticTimer = 0 }
    scrolling = false
    programmaticLock = false
    await cancelActiveRender()
    clearSlots()
    const previous = doc
    doc = null
    pageCount = 0
    currentPage = 1
    zoom = 1
    state.status = 'idle'
    state.page = 0
    state.pages = 0
    state.zoom = 1
    state.scale = 0
    state.error = null
    await abortTask()
    if (previous !== null) {
      try { await previous.destroy() } catch { /* Superseded loads own their own teardown. */ }
    }
  }

  const activeWindow = () => computeActivePageWindow(currentPage, pageCount, zoom)

  const recomputeGeometry = () => {
    if (slots.length === 0) return
    const available = Math.max(64, rootEl.clientWidth - 2 * PAGE_MARGIN)
    let y = topPaddingPx
    let maxSlotWidth = 0
    let firstScale = 0
    for (let i = 0; i < slots.length; i += 1) {
      const slot = slots[i]
      const cssScale = Math.min(
        zoom * available / slot.baseWidth,
        MAX_CANVAS_DIMENSION / slot.baseWidth,
        MAX_CANVAS_DIMENSION / slot.baseHeight,
      )
      if (i === 0) firstScale = cssScale
      slot.cssScale = cssScale
      slot.width = Math.max(1, slot.baseWidth * cssScale)
      slot.height = Math.max(1, slot.baseHeight * cssScale)
      slot.top = y
      slot.el.style.width = `${slot.width}px`
      slot.el.style.height = `${slot.height}px`
      if (slot.width > maxSlotWidth) maxSlotWidth = slot.width
      y += slot.height + PAGE_GAP
    }
    state.scale = firstScale
    const stackWidth = Math.max(rootEl.clientWidth, Math.ceil(maxSlotWidth + 2 * PAGE_MARGIN))
    stackEl.style.width = `${stackWidth}px`
    rootEl.style.touchAction = maxSlotWidth + 2 * PAGE_MARGIN > rootEl.clientWidth + 1 ? 'pan-x pan-y' : 'pan-y'
  }

  const findPageAtOffset = targetY => findPageAtScrollOffset(targetY, slots)

  const drawText = async (slot, scale, gen) => {
    try {
      const target = slot.pageProxy
      if (target === null) return
      const content = await target.getTextContent()
      if (disposed || gen !== renderGen || slot.pageProxy !== target) return
      const items = content?.items
      if (!Array.isArray(items) || items.length > MAX_TEXT_ITEMS) return
      let textEl = slot.textEl
      if (textEl === null) {
        textEl = document.createElement('div')
        textEl.className = 'pdf-text'
        textEl.setAttribute('role', 'document')
        slot.el.append(textEl)
        slot.textEl = textEl
      }
      const viewport = target.getViewport({ scale })
      const fragment = document.createDocumentFragment()
      for (const item of items) {
        if (typeof item?.str !== 'string' || item.str.length === 0) {
          if (item?.hasEOL === true) fragment.append(document.createElement('br'))
          continue
        }
        const box = Util.transform(viewport.transform, item.transform)
        const height = Math.hypot(box[2], box[3])
        if (!Number.isFinite(height) || height <= 0) continue
        const span = document.createElement('span')
        span.textContent = item.str
        span.style.left = `${box[4]}px`
        span.style.top = `${box[5] - height * 0.85}px`
        span.style.fontSize = `${height}px`
        span.style.fontFamily = content.styles?.[item.fontName]?.fontFamily ?? 'sans-serif'
        if (typeof item.dir === 'string' && item.dir !== 'auto') span.dir = item.dir
        fragment.append(span)
        if (item.hasEOL === true) fragment.append(document.createElement('br'))
      }
      textEl.replaceChildren(fragment)
    } catch { /* Missing text overlay is non-fatal when canvas renders cleanly. */ }
  }

  const renderSlot = async (slot, windowCount, gen) => {
    const owner = doc
    if (owner === null || disposed || gen !== renderGen) return
    let proxy = slot.pageProxy
    if (proxy === null) {
      proxy = await owner.getPage(slot.page)
      if (disposed || gen !== renderGen || doc !== owner) {
        try { proxy.cleanup() } catch {}
        return
      }
      slot.pageProxy = proxy
    }

    const base = proxy.getViewport({ scale: 1 })
    if (!Number.isFinite(base.width) || !Number.isFinite(base.height) || base.width <= 0 || base.height <= 0) {
      throw new Error('The page has no usable size.')
    }
    if (Math.abs(base.width - slot.baseWidth) > 0.5 || Math.abs(base.height - slot.baseHeight) > 0.5) {
      const oldHeight = slot.height
      slot.baseWidth = base.width
      slot.baseHeight = base.height
      recomputeGeometry()
      if (slot.page < currentPage && Number.isFinite(oldHeight)) {
        rootEl.scrollTop += slot.height - oldHeight
      }
    }

    const perPageBudget = Math.max(100_000, Math.min(MAX_CANVAS_PIXELS, Math.floor(MAX_TOTAL_CANVAS_PIXELS / Math.max(1, windowCount))))
    const deviceScale = Math.min(
      window.devicePixelRatio || 1,
      MAX_RATIO,
      Math.sqrt(perPageBudget / (slot.width * slot.height)),
      MAX_CANVAS_DIMENSION / slot.width,
      MAX_CANVAS_DIMENSION / slot.height,
    )
    if (!Number.isFinite(deviceScale) || deviceScale <= 0) throw new Error('The page cannot be scaled.')
    const renderScale = slot.cssScale * deviceScale
    const viewport = proxy.getViewport({ scale: renderScale })

    let canvas = slot.canvas
    if (canvas === null) {
      canvas = document.createElement('canvas')
      canvas.setAttribute('aria-hidden', 'true')
      slot.el.prepend(canvas)
      slot.canvas = canvas
    }
    const targetWidth = clamp(Math.floor(viewport.width), 1, MAX_CANVAS_DIMENSION)
    const targetHeight = clamp(Math.floor(viewport.height), 1, MAX_CANVAS_DIMENSION)
    if (canvas.width !== targetWidth) canvas.width = targetWidth
    if (canvas.height !== targetHeight) canvas.height = targetHeight
    const ctx = canvas.getContext('2d', { alpha: false })
    if (ctx === null) throw new Error('Unable to acquire 2D context.')

    const task = proxy.render({
      canvasContext: ctx,
      viewport,
      annotationMode: AnnotationMode.DISABLE,
      background: '#ffffff',
    })
    activeRender = task
    try {
      await task.promise
    } finally {
      if (activeRender === task) activeRender = null
    }
    if (disposed || gen !== renderGen || doc !== owner) return
    slot.renderedScale = slot.cssScale
    await drawText(slot, slot.cssScale, gen)
    if (!sentRendered && !disposed && gen === renderGen) {
      sentRendered = true
      state.status = 'rendered'
      state.page = currentPage
      state.pages = pageCount
      state.zoom = zoom
      state.error = null
      send({ type: 'rendered', id: session, page: currentPage, pages: pageCount, zoom })
    }
  }

  const renderThumbnail = async (pageNum, gen) => {
    const owner = doc
    if (owner === null || disposed || gen !== renderGen) return
    const slot = slots[pageNum - 1]
    if (!slot) return
    let proxy = slot.pageProxy
    let tempProxy = false
    if (proxy === null) {
      proxy = await owner.getPage(pageNum)
      tempProxy = true
      if (disposed || gen !== renderGen || doc !== owner) {
        try { proxy.cleanup() } catch {}
        return
      }
    }
    try {
      const base = proxy.getViewport({ scale: 1 })
      const scale = Math.min(THUMB_MAX_DIM / Math.max(1, base.width), THUMB_MAX_DIM / Math.max(1, base.height))
      const viewport = proxy.getViewport({ scale })
      thumbCanvas.width = clamp(Math.round(viewport.width), 1, THUMB_MAX_DIM)
      thumbCanvas.height = clamp(Math.round(viewport.height), 1, THUMB_MAX_DIM)
      const ctx = thumbCanvas.getContext('2d', { alpha: false })
      if (ctx === null) return
      const task = proxy.render({
        canvasContext: ctx,
        viewport,
        annotationMode: AnnotationMode.DISABLE,
        background: '#ffffff',
      })
      activeRender = task
      try {
        await task.promise
      } finally {
        if (activeRender === task) activeRender = null
      }
      if (disposed || gen !== renderGen || doc !== owner) return
      const dataUrl = thumbCanvas.toDataURL('image/jpeg', 0.72)
      if (dataUrl.length <= THUMB_MAX_DATA_URL) {
        send({ type: 'thumb', id: session, page: pageNum, dataUrl })
      }
    } finally {
      if (tempProxy && slot.pageProxy !== proxy) {
        try { proxy.cleanup() } catch {}
      }
    }
  }

  const nextWindowSlot = (start, end) => {
    const order = []
    for (let p = start; p <= end; p += 1) order.push(p)
    order.sort((a, b) => Math.abs(a - currentPage) - Math.abs(b - currentPage))
    for (const p of order) {
      const slot = slots[p - 1]
      if (!slot) continue
      if (slot.canvas === null || Math.abs(slot.renderedScale - slot.cssScale) > 0.01) {
        return slot
      }
    }
    return null
  }

  const schedulePump = () => {
    pumpRequested = true
    if (pumping || pinch !== null) return
    void pump()
  }

  const pump = async () => {
    if (pumping || pinch !== null) return
    pumping = true
    try {
      while (pumpRequested && !disposed && doc !== null && pinch === null) {
        pumpRequested = false
        const gen = renderGen
        const { start, end } = activeWindow()
        for (let p = 1; p <= slots.length; p += 1) {
          if (p < start || p > end) releaseSlot(slots[p - 1])
        }
        const targetSlot = nextWindowSlot(start, end)
        if (targetSlot !== null) {
          try {
            await renderSlot(targetSlot, end - start + 1, gen)
          } catch (error) {
            if (!disposed && gen === renderGen && error?.name !== 'RenderingCancelledException') {
              fail(errorCode(error))
              return
            }
          }
          pumpRequested = true
          await nextFrame()
          continue
        }

        if (!scrolling && pinch === null && thumbQueue.length > 0) {
          const nextThumb = thumbQueue.shift()
          thumbInQueue.delete(nextThumb)
          try {
            await renderThumbnail(nextThumb, gen)
          } catch (error) {
            if (error?.name !== 'RenderingCancelledException') {
              /* Non-fatal thumbnail skip. */
            }
          }
          if (thumbQueue.length > 0) {
            pumpRequested = true
            await nextFrame()
            continue
          }
        }
      }
    } finally {
      if (thumbQueue.length === 0) {
        thumbCanvas.width = 0
        thumbCanvas.height = 0
      }
      pumping = false
      if (pumpRequested && !disposed && doc !== null && pinch === null) {
        void pump()
      }
    }
  }

  const load = async value => {
    const mine = ++loadToken
    let reported = false
    const stop = code => {
      if (reported || disposed || mine !== loadToken) return
      reported = true
      fail(code)
    }
    if (typeof value !== 'string' || value.length === 0) { stop('invalid'); return }
    if (value.length > MAX_BASE64_CHARS) { stop('tooLarge'); return }
    if (!BASE64.test(value)) { stop('invalid'); return }
    await abortTask()
    if (disposed || mine !== loadToken) return
    let bytes
    try {
      const binary = atob(value)
      bytes = new Uint8Array(binary.length)
      for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
    } catch { stop('invalid'); return }
    let task
    try {
      task = getDocument({
        data: bytes,
        verbosity: VerbosityLevel.ERRORS,
        disableAutoFetch: true,
        disableRange: true,
        disableStream: true,
        useWorkerFetch: false,
        useWasm: false,
        useSystemFonts: true,
        stopAtErrors: false,
        enableXfa: false,
        enableHWA: false,
        enableWebGPU: false,
        canvasMaxAreaInBytes: MAX_CANVAS_PIXELS * 4,
      })
    } catch { stop('failed'); return }
    loadingTask = task
    task.onPassword = () => { stop('password') }
    let loaded
    try {
      loaded = await task.promise
    } catch (error) {
      stop(errorCode(error))
      return
    } finally {
      if (loadingTask === task) loadingTask = null
    }
    if (disposed || mine !== loadToken) {
      try { await loaded.destroy() } catch {}
      return
    }
    doc = loaded
    pageCount = loaded.numPages
    if (pageCount < 1) { stop('invalid'); return }
    currentPage = 1
    zoom = 1

    let firstPage
    try {
      firstPage = await loaded.getPage(1)
    } catch (error) {
      stop(errorCode(error))
      return
    }
    if (disposed || mine !== loadToken) {
      try { firstPage.cleanup() } catch {}
      return
    }
    const base = firstPage.getViewport({ scale: 1 })
    const defaultWidth = Number.isFinite(base.width) && base.width > 0 ? base.width : 595
    const defaultHeight = Number.isFinite(base.height) && base.height > 0 ? base.height : 842

    const fragment = document.createDocumentFragment()
    slots = []
    for (let p = 1; p <= pageCount; p += 1) {
      const el = document.createElement('div')
      el.className = 'pdf-slot'
      el.dataset.page = String(p)
      fragment.append(el)
      slots.push({
        page: p,
        el,
        baseWidth: defaultWidth,
        baseHeight: defaultHeight,
        cssScale: 1,
        width: defaultWidth,
        height: defaultHeight,
        top: 0,
        canvas: null,
        textEl: null,
        pageProxy: p === 1 ? firstPage : null,
        renderedScale: 0,
      })
    }
    stackEl.replaceChildren(fragment)
    recomputeGeometry()
    rootEl.scrollTo(0, 0)
    state.pages = pageCount
    state.page = 1
    state.zoom = 1
    send({ type: 'loaded', id: session, page: 1, pages: pageCount, aspectRatio: defaultHeight / defaultWidth })
    schedulePump()
  }

  const begin = async id => {
    const mine = ++beginToken
    await reset()
    if (disposed || mine !== beginToken) return
    session = typeof id === 'string' ? id : null
    dropChunks()
    state.status = 'loading'
    state.error = null
    state.page = 0
    state.pages = 0
    state.zoom = 1
    state.scale = 0
    send({ type: 'loading', id: session })
    send({ type: 'ack', id: session, index: 0 })
  }

  const append = (id, chunk) => {
    if (session === null || id !== session) return
    if (typeof chunk !== 'string' || chunk.length === 0) { fail('invalid'); return }
    if (chunkLength + chunk.length > MAX_BASE64_CHARS) { fail('tooLarge'); return }
    chunks.push(chunk)
    chunkLength += chunk.length
    send({ type: 'ack', id: session, index: chunks.length })
  }

  const finish = async id => {
    if (session === null || id !== session) return
    const value = chunks.join('')
    dropChunks()
    await load(value)
  }

  const onScroll = () => {
    if (doc === null || slots.length === 0) return
    scrolling = true
    if (scrollIdleTimer !== 0) clearTimeout(scrollIdleTimer)
    scrollIdleTimer = setTimeout(() => {
      scrollIdleTimer = 0
      scrolling = false
      schedulePump()
    }, 140)
    if (programmaticLock || scrollRaf !== 0) return
    scrollRaf = requestAnimationFrame(() => {
      scrollRaf = 0
      if (doc === null || slots.length === 0 || programmaticLock) return
      const visibleHeight = Math.max(1, rootEl.clientHeight - topPaddingPx)
      const targetY = rootEl.scrollTop + topPaddingPx + visibleHeight * 0.35
      const next = findPageAtOffset(targetY)
      if (next !== currentPage) {
        currentPage = next
        state.page = next
        send({ type: 'page', id: session, page: next, pages: pageCount })
        schedulePump()
      }
    })
  }

  const onResize = () => {
    const width = rootEl.clientWidth
    if (Math.abs(width - lastWidth) < 1) return
    lastWidth = width
    if (resizeTimer !== 0) clearTimeout(resizeTimer)
    resizeTimer = setTimeout(() => {
      resizeTimer = 0
      if (doc !== null) {
        const anchorRatio = currentPage > 0 && slots[currentPage - 1]
          ? clamp((rootEl.scrollTop + topPaddingPx - slots[currentPage - 1].top) / Math.max(1, slots[currentPage - 1].height), 0, 1)
          : 0
        recomputeGeometry()
        const target = slots[currentPage - 1]
        if (target) {
          rootEl.scrollTop = Math.max(0, target.top - topPaddingPx + anchorRatio * target.height)
        }
        schedulePump()
      }
    }, RESIZE_DEBOUNCE_MS)
  }

  window.beginPdf = id => { void begin(id) }
  window.appendPdfChunk = (id, chunk) => { append(id, chunk) }
  window.finishPdf = id => { void finish(id) }
  window.loadPdf = async base64 => {
    await begin('local')
    append('local', base64)
    await finish('local')
  }
  window.setPdfTheme = theme => {
    document.documentElement.dataset.theme = theme === 'dark' ? 'dark' : 'light'
  }
  window.setPdfTopPadding = px => {
    const value = Number(px)
    if (!Number.isFinite(value) || value < 0) return
    topPaddingPx = Math.max(12, Math.round(value))
    document.documentElement.style.setProperty('--pdf-top-pad', `${topPaddingPx}px`)
    if (doc !== null && slots.length > 0) recomputeGeometry()
  }
  window.scrollToPage = value => {
    const target = Math.floor(Number(value))
    if (!Number.isFinite(target) || doc === null || pageCount < 1) return
    const next = clamp(target, 1, pageCount)
    const slot = slots[next - 1]
    if (!slot) return
    programmaticLock = true
    if (programmaticTimer !== 0) clearTimeout(programmaticTimer)
    programmaticTimer = setTimeout(() => {
      programmaticTimer = 0
      programmaticLock = false
    }, 180)
    currentPage = next
    state.page = next
    const targetTop = Math.max(0, slot.top - topPaddingPx - 4)
    rootEl.scrollTo({ top: targetTop, behavior: 'auto' })
    send({ type: 'page', id: session, page: next, pages: pageCount })
    schedulePump()
  }
  window.requestThumbnails = pages => {
    if (!Array.isArray(pages) || doc === null) return
    for (const raw of pages) {
      const p = Math.floor(Number(raw))
      if (!Number.isFinite(p) || p < 1 || p > pageCount || thumbInQueue.has(p)) continue
      thumbInQueue.add(p)
      thumbQueue.push(p)
    }
    if (thumbQueue.length > MAX_THUMB_QUEUE) {
      thumbQueue = thumbQueue.slice(-MAX_THUMB_QUEUE)
      thumbInQueue.clear()
      for (const p of thumbQueue) thumbInQueue.add(p)
    }
    if (thumbQueue.length > 0) schedulePump()
  }
  window.clearThumbQueue = () => {
    thumbQueue = []
    thumbInQueue.clear()
  }

  const applyZoomAtPoint = (nextZoom, clientX, clientY) => {
    if (nextZoom === zoom || doc === null || slots.length === 0) return
    const stackRect = stackEl.getBoundingClientRect()
    const anchorXRatio = stackRect.width > 0 ? clamp((clientX - stackRect.left) / stackRect.width, 0, 1) : 0.5
    const anchorYRatio = stackRect.height > 0 ? clamp((clientY - stackRect.top) / stackRect.height, 0, 1) : 0
    zoom = nextZoom
    state.zoom = zoom
    recomputeGeometry()
    const newWidth = stackEl.scrollWidth
    const newHeight = stackEl.scrollHeight
    rootEl.scrollLeft = Math.max(0, anchorXRatio * newWidth - clientX)
    rootEl.scrollTop = Math.max(0, anchorYRatio * newHeight - clientY)
    send({ type: 'rendered', id: session, page: currentPage, pages: pageCount, zoom })
    schedulePump()
  }

  const touchDistance = (first, second) => Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY)

  rootEl.addEventListener('touchstart', event => {
    if (doc === null || slots.length === 0) return
    if (programmaticLock) {
      programmaticLock = false
      if (programmaticTimer !== 0) { clearTimeout(programmaticTimer); programmaticTimer = 0 }
    }
    if (event.touches.length === 1) {
      const touch = event.touches[0]
      singleTapCandidate = { x: touch.clientX, y: touch.clientY, time: Date.now() }
      return
    }
    singleTapCandidate = null
    if (event.touches.length !== 2) {
      const wasPinching = pinch !== null
      clearPinch()
      if (wasPinching) schedulePump()
      return
    }
    event.preventDefault()
    void cancelActiveRender()
    const [first, second] = event.touches
    const rect = stackEl.getBoundingClientRect()
    const clientX = (first.clientX + second.clientX) / 2
    const clientY = (first.clientY + second.clientY) / 2
    const originX = clientX - rect.left
    const originY = clientY - rect.top
    pinch = {
      distance: Math.max(1, touchDistance(first, second)),
      startZoom: zoom,
      target: zoom,
      clientX,
      clientY,
    }
    stackEl.style.willChange = 'transform'
    stackEl.style.transformOrigin = `${originX}px ${originY}px`
  }, { passive: false })

  rootEl.addEventListener('touchmove', event => {
    if (singleTapCandidate !== null && event.touches.length === 1) {
      const touch = event.touches[0]
      if (Math.hypot(touch.clientX - singleTapCandidate.x, touch.clientY - singleTapCandidate.y) > 10) {
        singleTapCandidate = null
      }
    }
    if (pinch === null || event.touches.length !== 2) return
    event.preventDefault()
    const [first, second] = event.touches
    pinch.target = clamp(pinch.startZoom * touchDistance(first, second) / pinch.distance, MIN_ZOOM, MAX_ZOOM)
    stackEl.style.transform = `scale(${pinch.target / pinch.startZoom})`
  }, { passive: false })

  rootEl.addEventListener('touchend', event => {
    if (pinch !== null && event.touches.length < 2) {
      const completed = pinch
      clearPinch()
      if (Math.abs(completed.target - zoom) > 0.01) {
        applyZoomAtPoint(completed.target, completed.clientX, completed.clientY)
      } else {
        schedulePump()
      }
      return
    }
    if (singleTapCandidate !== null && event.touches.length === 0 && event.changedTouches.length === 1) {
      const tap = singleTapCandidate
      singleTapCandidate = null
      const [end] = event.changedTouches
      if (Date.now() - tap.time < 280 && Math.hypot(end.clientX - tap.x, end.clientY - tap.y) < 10) {
        const now = Date.now()
        if (lastTap !== null && now - lastTap.time < 300 && Math.hypot(end.clientX - lastTap.x, end.clientY - lastTap.y) < 36) {
          lastTap = null
          const nextZoom = zoom > 1.25 ? 1 : 2
          applyZoomAtPoint(nextZoom, end.clientX, end.clientY)
        } else {
          lastTap = { x: end.clientX, y: end.clientY, time: now }
        }
      }
    }
  })
  rootEl.addEventListener('touchcancel', () => {
    singleTapCandidate = null
    clearPinch()
    schedulePump()
  })

  rootEl.addEventListener('scroll', onScroll, { passive: true })
  const observer = new ResizeObserver(onResize)
  observer.observe(rootEl)
  window.addEventListener('resize', onResize)
  window.addEventListener('pagehide', () => {
    disposed = true
    if (resizeTimer !== 0) {
      clearTimeout(resizeTimer)
      resizeTimer = 0
    }
    observer.disconnect()
    void reset()
  })

  lastWidth = rootEl.clientWidth
  state.status = 'ready'
  send({ type: 'ready' })
})()
