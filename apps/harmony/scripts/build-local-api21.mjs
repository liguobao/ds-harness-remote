#!/usr/bin/env node
/**
 * Build Harmony HAP locally on DevEco Studio 6.0.1 (SDK API 21) using gitignored
 * `build-profile.local.json5`, temporarily adjusting modelVersion & bundleName
 * to match the local debug provisioning profile, then cleanly restoring all
 * tracked manifest files on exit.
 */
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')

const localProfile = resolve(root, 'build-profile.local.json5')
if (!existsSync(localProfile)) {
  console.error('[build-local-api21] missing build-profile.local.json5')
  process.exit(1)
}

function readLocalBundleFromProfile(profileText) {
  const match = profileText.match(/"profile"\s*:\s*"([^"]+)"/)
  if (!match) return ''
  const p7bPath = match[1].replace(/^~(?=\/)/, homedir())
  if (!existsSync(p7bPath)) return ''
  const raw = readFileSync(p7bPath, 'latin1')
  const bundleMatch = raw.match(/"bundle-name"\s*:\s*"([^"]+)"/)
  return bundleMatch ? bundleMatch[1] : ''
}

function readLocalPushClientId() {
  const envId = (process.env.HARMONY_PUSH_CLIENT_ID ?? '').trim()
  if (envId.length > 0) return envId
  const localPushCfg = resolve(homedir(), '.dsh/huawei-push-local.json')
  if (!existsSync(localPushCfg)) return ''
  try {
    const parsed = JSON.parse(readFileSync(localPushCfg, 'utf8'))
    return typeof parsed?.clientId === 'string' ? parsed.clientId.trim() : ''
  } catch {
    return ''
  }
}

const DEVECO_CONTENTS = '/Applications/DevEco-Studio.app/Contents'
const HVIGORW = process.env.HVIGORW || `${DEVECO_CONTENTS}/tools/hvigor/bin/hvigorw`
const localProfileText = readFileSync(localProfile, 'utf8')
const localBundleName = (process.env.HARMONY_LOCAL_BUNDLE ?? readLocalBundleFromProfile(localProfileText)).trim()
const localClientId = readLocalPushClientId()
const buildMode = (process.env.HARMONY_BUILD_MODE ?? 'debug').trim()
const extraArgs = process.argv.slice(2)

const trackedFiles = [
  resolve(root, 'build-profile.json5'),
  resolve(root, 'oh-package.json5'),
  resolve(root, 'hvigor/hvigor-config.json5'),
  resolve(root, 'AppScope/app.json5'),
  resolve(root, 'entry/src/main/module.json5'),
  resolve(root, 'oh-package-lock.json5')
]

const backups = new Map()
for (const file of trackedFiles) {
  if (existsSync(file)) {
    backups.set(file, readFileSync(file))
  }
}

let restored = false
function restoreAll() {
  if (restored) return
  restored = true
  for (const [file, buf] of backups.entries()) {
    writeFileSync(file, buf)
  }
}

process.on('exit', restoreAll)
process.on('SIGINT', () => { restoreAll(); process.exit(130) })
process.on('SIGTERM', () => { restoreAll(); process.exit(143) })

try {
  copyFileSync(localProfile, resolve(root, 'build-profile.json5'))

  const ohPkgPath = resolve(root, 'oh-package.json5')
  writeFileSync(
    ohPkgPath,
    readFileSync(ohPkgPath, 'utf8').replace(/"modelVersion":\s*"[^"]+"/, '"modelVersion": "6.0.1"')
  )

  const hvigorCfgPath = resolve(root, 'hvigor/hvigor-config.json5')
  writeFileSync(
    hvigorCfgPath,
    readFileSync(hvigorCfgPath, 'utf8').replace(/"modelVersion":\s*"[^"]+"/, '"modelVersion": "6.0.1"')
  )

  if (localBundleName.length > 0) {
    const appJsonPath = resolve(root, 'AppScope/app.json5')
    writeFileSync(
      appJsonPath,
      readFileSync(appJsonPath, 'utf8').replace(/"bundleName":\s*"[^"]+"/, `"bundleName": "${localBundleName}"`)
    )
  }

  if (localClientId.length > 0) {
    const moduleJsonPath = resolve(root, 'entry/src/main/module.json5')
    writeFileSync(
      moduleJsonPath,
      readFileSync(moduleJsonPath, 'utf8').replace(
        /("name"\s*:\s*"client_id"\s*,\s*"value"\s*:\s*")[^"]*(")/,
        `$1${localClientId}$2`
      )
    )
  }

  const env = {
    ...process.env,
    DEVECO_SDK_HOME: process.env.DEVECO_SDK_HOME || `${DEVECO_CONTENTS}/sdk`,
    PATH: `${DEVECO_CONTENTS}/tools/hvigor/bin:${DEVECO_CONTENTS}/tools/node/bin:${DEVECO_CONTENTS}/tools/ohpm/bin:${process.env.PATH ?? ''}`
  }

  const args = ['--no-daemon', 'assembleHap', '-p', 'product=default', '-p', `buildMode=${buildMode}`, ...extraArgs]
  const res = spawnSync(HVIGORW, args, { cwd: root, env, stdio: 'inherit' })
  process.exitCode = res.status ?? 1
} finally {
  restoreAll()
}
