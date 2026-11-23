import { createRequire } from 'node:module'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const require = createRequire(import.meta.url)
const read = path => readFile(path, 'utf8')

/** Pinned in apps/android/package.json; bump both together after reviewing the pdf.js release. */
const PDFJS_VERSION = '6.3.289'
/** Bindings scripts/pdf-viewer.js resolves from the module scope of the bundled pdf.js module. */
const REQUIRED_EXPORTS = ['AnnotationMode', 'Util', 'VerbosityLevel', 'getDocument']
/** Must match PAGE_MARGIN in scripts/pdf-viewer.js. */
const PAGE_MARGIN = 12
const PAGE_GAP = 12

const pdfjsPackage = require.resolve('pdfjs-dist/package.json')
const { version } = JSON.parse(await read(pdfjsPackage))
if (version !== PDFJS_VERSION) {
  throw new Error(`build-pdf.mjs bundles pdfjs-dist ${PDFJS_VERSION} but resolved ${version}.`)
}

const [api, worker, viewportMath, viewer] = await Promise.all([
  read(resolve(dirname(pdfjsPackage), 'legacy/build/pdf.mjs')),
  read(resolve(dirname(pdfjsPackage), 'legacy/build/pdf.worker.mjs')),
  read(resolve(import.meta.dirname, 'pdf-viewport-math.js')),
  read(resolve(import.meta.dirname, 'pdf-viewer.js')),
])

const exportLines = [...api.matchAll(/^export \{([^}]*)\};?$/gm)]
const exported = new Set((exportLines.at(-1)?.[1] ?? '').split(',').map(name => name.trim()).filter(Boolean))
const missing = REQUIRED_EXPORTS.filter(name => !exported.has(name))
if (missing.length > 0) throw new Error(`pdfjs-dist ${version} no longer exports ${missing.join(', ')}.`)

/**
 * An inline script ends at the first `</script`, and `<!--` opens the HTML escaped state that a
 * later `-->` closes. Both replacements stay valid JavaScript in strings and comments; neither
 * sequence occurs in the pinned sources today, so this is a guard against future releases.
 */
const inline = source => source.replaceAll('</script', '<\\/script').replaceAll('<!--', '<\\!--')

/**
 * Runs before the deferred module scripts. The app WebView must not reach the network or eval, so
 * pdf.js gets the Promise.withResolvers it requires (Chrome 119+) without any fetch, every console
 * call is dropped because pdf.js warnings can quote document content into logcat, and no popup or
 * followed link may leave the page (React Native would hand an unlisted URL to the OS).
 */
const boot = `
if (typeof Promise.withResolvers !== 'function') {
  Promise.withResolvers = function () {
    let resolve, reject
    const promise = new Promise(function (res, rej) { resolve = res; reject = rej })
    return { promise: promise, resolve: resolve, reject: reject }
  }
}
const silence = function () {}
for (const name of ['log','info','debug','warn','error','trace','table','dir','dirxml','group','groupCollapsed','groupEnd','assert','count','time','timeLog','timeEnd']) {
  console[name] = silence
}
window.open = function () { return null }
window.alert = silence
window.prompt = function () { return null }
window.confirm = function () { return false }
document.addEventListener('click', function (event) { event.preventDefault(); event.stopPropagation() }, true)
`

const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; worker-src 'none'; frame-src 'none'; object-src 'none'; media-src 'none'; base-uri 'none'; form-action 'none'">
<title>PDF</title>
<style>
:root{--pdf-backdrop:#f2f3f5;--pdf-edge:rgba(15,15,15,.08);--pdf-border:rgba(15,15,15,.08);--pdf-top-pad:12px}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--pdf-backdrop:#111418;--pdf-edge:rgba(0,0,0,.48);--pdf-border:rgba(255,255,255,.08)}}
html[data-theme="dark"]{--pdf-backdrop:#111418;--pdf-edge:rgba(0,0,0,.48);--pdf-border:rgba(255,255,255,.08)}
html,body{height:100%;margin:0;background:var(--pdf-backdrop);-webkit-text-size-adjust:100%;overflow:hidden}
#pdf-root{height:100%;overflow:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;scrollbar-gutter:stable}
#pdf-stack{display:flex;flex-direction:column;align-items:center;gap:${PAGE_GAP}px;padding:var(--pdf-top-pad) ${PAGE_MARGIN}px 28px;box-sizing:border-box;min-width:100%;transform-origin:0 0}
.pdf-slot{position:relative;background:#fff;box-shadow:0 2px 8px var(--pdf-edge);border:1px solid var(--pdf-border);border-radius:4px;overflow:hidden;flex:0 0 auto;contain:layout style paint}
.pdf-slot canvas{display:block;width:100%;height:100%;user-select:none;-webkit-tap-highlight-color:transparent}
.pdf-text{position:absolute;top:0;left:0;right:0;bottom:0;overflow:hidden;pointer-events:none;user-select:none;color:transparent;line-height:1}
.pdf-text span{position:absolute;white-space:pre;transform-origin:0 0}
</style>
</head>
<body>
<div id="pdf-root"><div id="pdf-stack"></div></div>
<script>${boot}</script>
<script type="module">${inline(worker)}</script>
<script type="module">${inline(api)}
${inline(viewportMath)}
${inline(viewer)}</script>
</body>
</html>`

const out = resolve(import.meta.dirname, '../src/generated/pdf-html.ts')
await mkdir(dirname(out), { recursive: true })
await writeFile(out, `// Generated by scripts/build-pdf.mjs from pinned pdfjs-dist@${version} (legacy build).\nexport const pdfHtml = ${JSON.stringify(html)}\n`)
