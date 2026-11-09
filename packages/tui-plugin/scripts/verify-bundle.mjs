import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const component = JSON.parse(await readFile(join(root, 'dsh-plugin.json'), 'utf8'))
const patch = await readFile(join(root, 'cordis.patch.yml'), 'utf8')
const bundle = await readFile(join(root, 'dist/index.js'), 'utf8')
const releaseRoot = join(root, '..', 'tui')
const releaseManifest = JSON.parse(await readFile(join(releaseRoot, 'package.json'), 'utf8'))
const releasePatch = await readFile(join(releaseRoot, 'cordis.patch.yml'), 'utf8')

assert.equal(manifest.name, 'ds-harness-remote-tui')
assert.equal(component.facets.host.entry, 'dist/index.js')
assert.match(patch, /name: 'ds-harness-remote-tui'/)
assert.match(patch, /name: '@deepseek-ai\/dsh-api-remotes'/)
assert.match(bundle, /dsh-TUI Remote needs @deepseek-ai\/dsh-api-remotes/)
assert.doesNotMatch(bundle, /(?:from\s+|require\()['"]@dsh-remote\//)

const { apply } = await import('../dist/index.js')
const names = [...patch.matchAll(/name: '([^']+)'/g)].map(match => match[1])
const loader = {
  entries: () => names.map(name => ({ options: { name }, disabled: name === '@deepseek-ai/dsh-api-remotes' })),
}
assert.throws(
  () => apply({ get: () => loader }),
  /Host API packages are missing or disabled: @deepseek-ai\/dsh-api-remotes/,
)

for (const packageName of names.filter(name => name.startsWith('@deepseek-ai/'))) {
  assert.match(releasePatch, new RegExp(`name: ['"]${packageName}['"]`))
  assert.equal(releaseManifest.dependencies[packageName], '0.2.2-rc.1')
}
assert.match(releasePatch, /inject: \[settings, connection\]/)
const { apply: applyRelease } = await import('../../tui/index.js')
assert.throws(
  () => applyRelease({ get: () => loader }),
  /Host API packages are missing or disabled: @deepseek-ai\/dsh-api-remotes/,
)
