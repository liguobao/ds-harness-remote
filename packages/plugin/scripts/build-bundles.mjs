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
  // werift must stay inside this bundle. It declares `buffer` (a Node
  // core-module name) as a dependency; DSH's generation peer validation walks
  // every installed package's dependencies, Node resolves a core-module name to
  // the builtin id instead of a path, and the validator treats that id as
  // outside the install closure, so the whole plugin install fails. Bundling
  // werift removes it from the installed dependency graph; at runtime it only
  // ever reached Node's builtin `buffer` anyway.
  external: ['@deepseek-ai/*', '@roamhq/wrtc', 'qrcode', 'ws'],
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
