// Exercise the shipped Host closure, not Vitest's transformed TS modules.
// Run after building packages/**: node scripts/verify-packed-webrtc.mjs
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const staging = mkdtempSync(join(tmpdir(), 'dsh-packed-webrtc-'))
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
function run(command, args, cwd) {
  return execFileSync(command, args, { cwd, encoding: 'utf8', timeout: 180_000, stdio: ['ignore', 'pipe', 'pipe'] })
}
function inside(path, directory) {
  const rel = relative(directory, path)
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
}

// Deliberately reproduce the host's problematic path-based builtin check:
// do NOT skip `buffer` using isBuiltin here. An external werift must fail.
function verifyClosure(modules, generation, installation) {
  const list = directory => readdirSync(directory).flatMap(name => name.startsWith('@')
    ? readdirSync(join(directory, name)).map(child => join(directory, name, child))
    : name.startsWith('.') ? [] : [join(directory, name)])
  const packages = list(modules)
  const visited = new Set()
  let count = 0
  for (const directory of packages) {
    const physicalDirectory = realpathSync(directory)
    if (visited.has(physicalDirectory)) continue
    visited.add(physicalDirectory)
    const nested = join(directory, 'node_modules')
    if (existsSync(nested)) packages.push(...list(nested))
    const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'))
    assert.notEqual(manifest.name, 'werift', 'werift must not enter the production installation tree')
    const require = createRequire(join(directory, 'package.json'))
    for (const dependency of Object.keys(manifest.dependencies ?? {})) {
      if (dependency in (manifest.optionalDependencies ?? {})) continue
      const resolved = require.resolve(dependency)
      assert.ok(isAbsolute(resolved), `${manifest.name}: ${dependency} resolves to builtin id ${resolved}`)
      const physical = realpathSync(resolved)
      assert.ok(inside(physical, generation) || inside(physical, installation),
        `${manifest.name}: ${dependency} resolves outside the generation and installation closure`)
    }
    count++
  }
  return count
}

try {
  // The real host supplies peer singletons outside the generation. Keep them
  // in a separate installation closure and disable automatic peer installation.
  writeFileSync(join(staging, 'package.json'), '{"private":true,"type":"module"}\n')
  run(npm, ['install', '--ignore-scripts', '--omit=optional', '--legacy-peer-deps', '--no-audit', '--no-fund',
    '@deepseek-ai/cordis@4.0.5', '@deepseek-ai/dsh-scope@0.2.1-rc.1', '@deepseek-ai/dsh-client-connection@0.2.1-rc.1'], staging)
  const installation = realpathSync(join(staging, 'node_modules'))

  for (const [label, directory, bundle] of [
    ['github', root, 'packages/plugin/dist/index.js'],
    ['npm', join(root, 'packages/plugin'), 'dist/index.js'],
  ]) {
    const destination = join(staging, label)
    mkdirSync(destination)
    const pack = JSON.parse(run(npm, ['pack', '--ignore-scripts', '--json', '--pack-destination', destination], directory))[0]
    const generation = join(destination, 'generation')
    mkdirSync(generation)
    writeFileSync(join(generation, 'package.json'), '{"private":true,"type":"module"}\n')
    run(npm, ['install', '--ignore-scripts', '--omit=dev', '--omit=optional', '--legacy-peer-deps', '--no-audit', '--no-fund',
      join(destination, pack.filename)], generation)
    const modules = join(generation, 'node_modules')
    const count = verifyClosure(modules, generation, installation)
    const plugin = join(modules, 'ds-harness-remote')
    const manifest = JSON.parse(readFileSync(join(plugin, 'package.json'), 'utf8'))
    assert.equal(manifest.dependencies?.werift, undefined)
    // An ordinary import tests the untouched package entry. A second import
    // uses a loader-only export seam to reach private transport functions in
    // the SAME packed bundle. It neither substitutes nor rebuilds their code.
    const output = run(process.execPath, [join(root, 'scripts/verify-packed-webrtc-runtime.mjs'),
      join(plugin, label === 'github' ? 'index.js' : bundle), join(plugin, bundle)], generation)
    console.log(`${label}: ${count} production packages, closure validation passed; ${output.trim()}`)
  }
} finally {
  rmSync(staging, { recursive: true, force: true })
}
