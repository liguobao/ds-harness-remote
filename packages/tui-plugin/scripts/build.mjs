import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

await build({
  entryPoints: [join(root, 'src/index.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  sourcemap: false,
  outfile: join(root, 'dist/index.js'),
  external: ['@deepseek-ai/dsh-client-connection', '@roamhq/wrtc'],
  banner: {
    js: 'import { createRequire as __dshCreateRequire } from "node:module";\nconst require = __dshCreateRequire(import.meta.url);',
  },
})
