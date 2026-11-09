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
const releaseManifestSource = await readFile(join(releaseRoot, 'package.json'), 'utf8')
const releaseManifest = JSON.parse(releaseManifestSource)
const releasePatch = await readFile(join(releaseRoot, 'cordis.patch.yml'), 'utf8')
const releaseIndex = await readFile(join(releaseRoot, 'index.js'), 'utf8')

function uniqueSortedPackages(label, packages) {
  const duplicates = packages.filter((name, index) => packages.indexOf(name) !== index)
  assert.deepEqual(duplicates, [], `${label} has duplicate API packages`)
  return [...packages].sort()
}

assert.equal(manifest.name, 'ds-harness-remote-tui')
assert.equal(component.facets.host.entry, 'dist/index.js')
assert.match(patch, /name: 'ds-harness-remote-tui'/)
assert.match(patch, /name: '@deepseek-ai\/dsh-api-remotes'/)
assert.match(bundle, /dsh-TUI Remote needs @deepseek-ai\/dsh-api-remotes/)
assert.doesNotMatch(bundle, /(?:from\s+|require\()['"]@dsh-remote\//)

const { apply } = await import('../dist/index.js')
const names = [...patch.matchAll(/^\s*name:\s*(?:'([^']+)'|"([^"]+)"|([^\s#]+))\s*$/gm)]
  .map(match => match[1] ?? match[2] ?? match[3])
const developmentApiPackages = uniqueSortedPackages('Development patch', names.filter(name => name.startsWith('@deepseek-ai/')))
const dependencyBlock = releaseManifestSource.match(/"dependencies"\s*:\s*\{([^}]*)\}/)?.[1]
assert.ok(dependencyBlock, 'Published package has no dependencies block')
const releaseApiDependencies = uniqueSortedPackages('Published dependencies',
  [...dependencyBlock.matchAll(/^\s*"(@deepseek-ai\/[^\"]+)"\s*:/gm)].map(match => match[1]))
const requiredBlock = releaseIndex.match(/const requiredHostApiPackages\s*=\s*\[([\s\S]*?)\]/)?.[1]
assert.ok(requiredBlock, 'Published entry has no requiredHostApiPackages list')
const requiredLines = requiredBlock.split('\n').map(line => line.trim()).filter(Boolean)
const requiredHostApiPackages = uniqueSortedPackages('Published entry', requiredLines.map(line => {
  const match = line.match(/^['"](@deepseek-ai\/[^'"]+)['"],?$/)
  assert.ok(match, `Invalid requiredHostApiPackages item: ${line}`)
  return match[1]
}))
assert.deepEqual(releaseApiDependencies, developmentApiPackages, 'Published API dependencies differ from development patch')
assert.deepEqual(requiredHostApiPackages, developmentApiPackages, 'Published entry differs from development patch')
const loader = {
  entries: () => names.map(name => ({ options: { name }, disabled: name === '@deepseek-ai/dsh-api-remotes' })),
}
assert.throws(
  () => apply({ get: () => loader }),
  /Host API packages are missing or disabled: @deepseek-ai\/dsh-api-remotes/,
)

for (const packageName of developmentApiPackages) {
  assert.match(releasePatch, new RegExp(`name: ['"]${packageName}['"]`))
  assert.equal(releaseManifest.dependencies[packageName], '0.2.2-rc.1')
}
assert.match(releasePatch, /inject: \[settings, connection\]/)
const { apply: applyRelease } = await import('../../tui/index.js')
assert.throws(
  () => applyRelease({ get: () => loader }),
  /Host API packages are missing or disabled: @deepseek-ai\/dsh-api-remotes/,
)
