// Inlined after the bundled pdf.js module by scripts/build-pdf.mjs. pdf.js resolves its worker
// through globalThis.pdfjsWorker, which the bundled worker module installs, so the worker runs on
// the main thread and this page spawns no Worker, fetches nothing and touches no file.
;(() => {
  const MAX_BASE64_CHARS = Math.ceil((8 * 1024 * 1024) / 3) * 4
  const MAX_CANVAS_PIXELS = 4000000
  const MAX_CANVAS_DIMENSION = 8192
  const MAX_RATIO = 2
  const MAX_TEXT_ITEMS = 5000
  const MIN_ZOOM = 0.25
  const MAX_ZOOM = 8
  /** Must match the #pdf-page margin in the generated page. */
  const PAGE_MARGIN = 8
  const RESIZE_DEBOUNCE_MS = 120
  const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/

  if (typeof getDocument !== 'function' || typeof globalThis.pdfjsWorker?.WorkerMessageHandler?.setup !== 'function') {
    throw new Error('The bundled pdf.js module is incomplete.')
  }

  const rootEl = document.getElementById('pdf-root')
  const pageEl = document.getElementById('pdf-page')
  const canvasEl = document.getElementById('pdf-canvas')
  const textEl = document.getElementById('pdf-text')
  const context = canvasEl.getContext('2d', { alpha: false })

  const state = { status: 'idle', page: 0, pages: 0, zoom: 1, scale: 0, error: null }
  window.pdfState = state

  let session = null
  let chunks = []
  let chunkLength = 0
  let beginToken = 0
  let loadToken = 0
  let pageToken = 0
  let renderToken = 0
  let loadingTask = null
  let doc = null
  let current = null
  let pageNumber = 0
  let pageCount = 0
  let zoom = 1
  let activeRender = null
  let resizeTimer = 0
  let lastWidth = 0
  let disposed = false

  const clamp = (value, min, max) => Math.min(Math.max(value, min), max)
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

  const cancelRender = async () => {
    const task = activeRender
    activeRender = null
    if (task === null) return
    try { task.cancel() } catch { /* Already settled. */ }
    try { await task.promise } catch { /* Reported by the render call that owns the token. */ }
  }

  const releasePage = () => {
    const previous = current
    current = null
    textEl.replaceChildren()
    canvasEl.width = 1
    canvasEl.height = 1
    try { previous?.cleanup() } catch { /* The document may already be destroyed. */ }
  }

  const reset = async () => {
    renderToken += 1
    pageToken += 1
    loadToken += 1
    session = null
    dropChunks()
    await cancelRender()
    releasePage()
    const previous = doc
    doc = null
    pageNumber = 0
    pageCount = 0
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

  const drawText = async (target, scale, mine) => {
    try {
      const content = await target.getTextContent()
      if (mine !== renderToken) return
      const items = content?.items
      if (!Array.isArray(items) || items.length > MAX_TEXT_ITEMS) return
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
    } catch { /* The canvas already shows the page; a missing text overlay is not a render failure. */ }
  }

  const render = async () => {
    const mine = ++renderToken
    let task = null
    try {
      await cancelRender()
      if (disposed || mine !== renderToken || current === null || context === null) return
      const base = current.getViewport({ scale: 1 })
      if (!Number.isFinite(base.width) || !Number.isFinite(base.height) || base.width <= 0 || base.height <= 0) {
        throw new Error('The page has no usable size.')
      }
      const available = Math.max(64, rootEl.clientWidth - 2 * PAGE_MARGIN)
      const cssScale = Math.min(
        zoom * available / base.width,
        MAX_CANVAS_DIMENSION / base.width,
        MAX_CANVAS_DIMENSION / base.height,
      )
      const width = Math.max(1, base.width * cssScale)
      const height = Math.max(1, base.height * cssScale)
      const deviceScale = Math.min(
        window.devicePixelRatio || 1,
        MAX_RATIO,
        Math.sqrt(MAX_CANVAS_PIXELS / (width * height)),
        MAX_CANVAS_DIMENSION / width,
        MAX_CANVAS_DIMENSION / height,
      )
      if (!Number.isFinite(deviceScale) || deviceScale <= 0) throw new Error('The page cannot be scaled.')
      const viewport = current.getViewport({ scale: cssScale * deviceScale })
      canvasEl.width = clamp(Math.floor(viewport.width), 1, MAX_CANVAS_DIMENSION)
      canvasEl.height = clamp(Math.floor(viewport.height), 1, MAX_CANVAS_DIMENSION)
      pageEl.style.width = `${width}px`
      pageEl.style.height = `${height}px`
      textEl.replaceChildren()
      state.scale = cssScale
      task = current.render({
        canvasContext: context,
        viewport,
        annotationMode: AnnotationMode.DISABLE,
        background: '#ffffff',
      })
      activeRender = task
      await task.promise
      if (disposed || mine !== renderToken) return
      await drawText(current, cssScale, mine)
      if (disposed || mine !== renderToken) return
      state.status = 'rendered'
      state.page = current.pageNumber
      state.pages = pageCount
      state.zoom = zoom
      state.error = null
      send({ type: 'rendered', id: session, page: current.pageNumber, pages: pageCount, zoom })
    } catch (error) {
      if (disposed || mine !== renderToken || error?.name === 'RenderingCancelledException') return
      fail(errorCode(error))
    } finally {
      if (activeRender === task) activeRender = null
    }
  }

  const goToPage = async target => {
    const owner = doc
    const mine = ++pageToken
    renderToken += 1
    // The requested page is recorded first so a newer request can never be undone by a stale one.
    pageNumber = target
    await cancelRender()
    if (disposed || owner === null || mine !== pageToken || doc !== owner) return
    releasePage()
    let next
    try {
      next = await owner.getPage(target)
    } catch (error) {
      if (!disposed && mine === pageToken && doc === owner) fail(errorCode(error))
      return
    }
    if (disposed || mine !== pageToken || doc !== owner) {
      try { next.cleanup() } catch { /* Owned by a newer document now. */ }
      return
    }
    current = next
    await render()
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
        /** Tooling stays quiet: the page silences the console, so failures travel as messages. */
        verbosity: VerbosityLevel.ERRORS,
        /** Every byte is in memory; no range, stream, fetch or wasm path may reach out. */
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
    /** Encrypted documents have no password prompt here, so they fail closed. */
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
      try { await loaded.destroy() } catch { /* Superseded loads own their own teardown. */ }
      return
    }
    doc = loaded
    pageCount = loaded.numPages
    if (pageCount < 1) { stop('invalid'); return }
    pageNumber = 1
    zoom = 1
    let next
    try {
      next = await loaded.getPage(1)
    } catch (error) {
      stop(errorCode(error))
      return
    }
    if (disposed || mine !== loadToken) {
      try { next.cleanup() } catch { /* Superseded loads own their own teardown. */ }
      return
    }
    current = next
    await render()
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

  const onResize = () => {
    const width = rootEl.clientWidth
    if (Math.abs(width - lastWidth) < 1) return
    lastWidth = width
    if (resizeTimer !== 0) clearTimeout(resizeTimer)
    resizeTimer = setTimeout(() => {
      resizeTimer = 0
      if (doc !== null) void render()
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
  window.showPage = value => {
    const target = Math.floor(Number(value))
    if (!Number.isFinite(target) || doc === null || pageCount < 1) return
    const next = clamp(target, 1, pageCount)
    if (next === pageNumber && current !== null) {
      rootEl.scrollTo(0, 0)
      return
    }
    void goToPage(next)
  }
  window.zoomPdf = value => {
    const delta = Number(value)
    if (!Number.isFinite(delta) || doc === null) return
    zoom = clamp(Math.round(zoom * (1 + delta) * 1000) / 1000, MIN_ZOOM, MAX_ZOOM)
    void render()
  }

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
