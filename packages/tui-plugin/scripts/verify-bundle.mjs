import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const component = JSON.parse(await readFile(join(root, 'dsh-plugin.json'), 'utf8'))
const patch = await readFile(join(root, 'cordis.patch.yml'), 'utf8')
const bundle = await readFile(join(root, 'dist/index.js'), 'utf8')

assert.equal(manifest.name, 'ds-harness-remote-tui')
assert.equal(component.facets.host.entry, 'dist/index.js')
assert.match(patch, /name: 'ds-harness-remote-tui'/)
assert.match(patch, /name: '@deepseek-ai\/dsh-api-remotes'/)
assert.match(bundle, /dsh-TUI Remote needs @deepseek-ai\/dsh-api-remotes/)
assert.doesNotMatch(bundle, /(?:from\s+|require\()['"]@dsh-remote\//)
