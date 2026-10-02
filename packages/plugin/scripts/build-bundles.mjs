import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

await build({
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
  await build({
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
