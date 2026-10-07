import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdir, writeFile } from 'node:fs/promises'
import { build } from 'esbuild'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

async function buildBundle(options) {
  const result = await build({ ...options, write: false })
  for (const file of result.outputFiles) {
    // esbuild includes physical dependency locations in module headers and
    // CommonJS wrapper keys (used only to find the module's initializer).
    // Keep committed JS identical across pnpm isolated and hoisted installs;
    // source maps retain the actual paths used by this build for debugging.
    const content = file.path.endsWith('.js')
      ? file.text
        .replace(/^([ \t]*\/\/ )(?:.*\/)?node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?(.+)$/gm, '$1node_modules/$2')
        .replace(/^([ \t]*")(?:[^"\r\n]*\/)?node_modules\/(?:\.pnpm\/[^/"\r\n]+\/node_modules\/)?([^"\r\n]+)("\([^\r\n)]*\) \{)$/gm, '$1node_modules/$2$3')
      : file.contents
    await mkdir(dirname(file.path), { recursive: true })
    await writeFile(file.path, content)
  }
}

await buildBundle({
  entryPoints: [join(root, 'src/index.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  sourcemap: true,
  outfile: join(root, 'dist/index.js'),
  external: ['@deepseek-ai/*', '@roamhq/wrtc', 'qrcode', 'werift', 'ws'],
})

for (const [moduleId, outfile] of [
  ['ds-harness-remote', 'client.js'],
  ['ds-harness-remote', 'client.github.js'],
]) {
  await buildBundle({
    entryPoints: [join(root, 'src/client.ts')],
    bundle: true,
    platform: 'browser',
    format: 'iife',
    minifySyntax: true,
    define: {
      DSH_REMOTE_CLIENT_MODULE_ID: JSON.stringify(moduleId),
    },
    outfile: join(root, 'dist', outfile),
  })
}
