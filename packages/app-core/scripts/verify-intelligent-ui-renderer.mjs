#!/usr/bin/env node
/**
 * Standalone verifier for the bundled Intelligent UI offline renderer.
 * Checks bundle size and API symbol markers, then confirms the top-level
 * mount export by evaluating the trusted bundle in a minimal DOM/window stub.
 * Node vm is not a security sandbox; this does not exercise mount or WebView.
 */
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const here = dirname(fileURLToPath(import.meta.url))
const generatedFile = resolve(here, '../src/generated/intelligent-ui-renderer-code.ts')

const required = process.env.DSH_REQUIRE_INTELLIGENT_UI === '1'
  || process.env.DSH_REQUIRE_INTELLIGENT_UI === 'true'
  || process.argv.includes('--require')

let content = ''
try {
  content = await readFile(generatedFile, 'utf8')
} catch (err) {
  if (required) {
    console.error('::error::Generated intelligent-ui-renderer-code.ts does not exist!')
    process.exit(1)
  }
  console.log('Intelligent UI verifier: generated file not found (fallback ok when not required)')
  process.exit(0)
}

const match = content.match(/export const INTELLIGENT_UI_RENDERER_CODE: string = ([\s\S]*)/)
if (!match) {
  console.error('::error::Could not parse INTELLIGENT_UI_RENDERER_CODE from generated file')
  process.exit(1)
}

let code = ''
try {
  code = JSON.parse(match[1].trim().replace(/;?$/, ''))
} catch (err) {
  console.error('::error::Failed to parse JSON string from generated file:', err)
  process.exit(1)
}

if (!code) {
  if (required) {
    console.error('::error::INTELLIGENT_UI_RENDERER_CODE is empty but renderer is required!')
    process.exit(1)
  }
  console.log('Intelligent UI verifier: empty renderer code (safe fallback mode OK)')
  process.exit(0)
}

// 1. Static validation
if (code.length < 50_000) {
  console.error(`::error::Renderer bundle is suspiciously small (${code.length} bytes)`)
  process.exit(1)
}

const requiredSymbols = ['DshIntelligentUiRenderer', 'mount', 'render', 'setTheme', 'dispose']
for (const sym of requiredSymbols) {
  if (!code.includes(sym)) {
    console.error(`::error::Renderer bundle is missing required symbol: ${sym}`)
    process.exit(1)
  }
}

// 2. Trusted bundle entry evaluation (not a mount/render/device smoke test)
const fakeElement = {
  appendChild() {},
  removeChild() {},
  addEventListener() {},
  removeEventListener() {},
  setAttribute() {},
  removeAttribute() {},
  style: {},
}

const sandbox = {
  window: {},
  document: {
    createElement: () => ({ ...fakeElement }),
    head: { appendChild() {}, removeChild() {} },
    body: { appendChild() {}, removeChild() {} },
    documentElement: { style: {}, scrollHeight: 600 },
  },
  ResizeObserver: class {
    observe() {}
    disconnect() {}
    unobserve() {}
  },
  console,
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
}
sandbox.window = sandbox
sandbox.self = sandbox
sandbox.globalThis = sandbox

try {
  vm.runInNewContext(code, sandbox, { timeout: 3000 })
  const renderer = sandbox.DshIntelligentUiRenderer || sandbox.window?.DshIntelligentUiRenderer
  if (!renderer || typeof renderer.mount !== 'function') {
    console.error('::error::DshIntelligentUiRenderer.mount is not a function after evaluation!')
    process.exit(1)
  }
  console.log(`Intelligent UI verifier: verified bundle (${Math.round(code.length / 1024)} KB) - mount export confirmed (mount/render not exercised)`)
} catch (err) {
  console.error('::error::Failed to evaluate trusted renderer entry:', err)
  process.exit(1)
}
