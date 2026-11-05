#!/usr/bin/env node
/**
 * Inject HarmonyOS signing material into build-profile.json5 from CI secrets.
 *
 * Signing credentials must never be committed. The repository therefore ships an empty
 * `signingConfigs` array, and CI materialises the keystore, certificate and provisioning
 * profile from environment variables right before `hvigorw assembleHap`.
 *
 * Required environment variables:
 *   HARMONY_SIGNING_STORE_B64       base64 of the .p12 keystore
 *   HARMONY_SIGNING_STORE_PASSWORD  keystore password (plain)
 *   HARMONY_SIGNING_KEY_ALIAS       key alias inside the keystore
 *   HARMONY_SIGNING_KEY_PASSWORD    key password (plain)
 *   HARMONY_SIGNING_CERT_B64        base64 of the .cer certificate (PEM or DER)
 *   HARMONY_SIGNING_PROFILE_B64     base64 of the .p7b provisioning profile
 *
 * Optional:
 *   HARMONY_SIGNING_OUT_DIR         where material is written (default: build/signing)
 *   HARMONY_SIGNING_CONFIG_NAME     signingConfig name (default: release)
 *   HARMONY_BUILD_PROFILE           build-profile path (default: build-profile.json5)
 *
 * Exit codes: 0 injected, 2 skipped (no secrets present — unsigned build), 1 error.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(here, '..')

const REQUIRED = [
  'HARMONY_SIGNING_STORE_B64',
  'HARMONY_SIGNING_STORE_PASSWORD',
  'HARMONY_SIGNING_KEY_ALIAS',
  'HARMONY_SIGNING_KEY_PASSWORD',
  'HARMONY_SIGNING_CERT_B64',
  'HARMONY_SIGNING_PROFILE_B64'
]

const missing = REQUIRED.filter((name) => (process.env[name] ?? '').length === 0)
if (missing.length === REQUIRED.length) {
  console.log('[signing] no signing secrets provided; leaving the build unsigned')
  process.exit(2)
}
if (missing.length > 0) {
  console.error(`[signing] incomplete signing secrets, missing: ${missing.join(', ')}`)
  process.exit(1)
}

const outDirSetting = (process.env.HARMONY_SIGNING_OUT_DIR ?? '').trim()
const outDirRaw = outDirSetting.length > 0 ? outDirSetting : join(projectRoot, 'build', 'signing')
const outDir = isAbsolute(outDirRaw) ? outDirRaw : resolve(projectRoot, outDirRaw)
mkdirSync(outDir, { recursive: true })

function materialise(envName, fileName) {
  const target = join(outDir, fileName)
  writeFileSync(target, Buffer.from(process.env[envName], 'base64'))
  return target
}

const storeFile = materialise('HARMONY_SIGNING_STORE_B64', 'upload.p12')
const certPath = materialise('HARMONY_SIGNING_CERT_B64', 'upload.cer')
const profilePath = materialise('HARMONY_SIGNING_PROFILE_B64', 'upload.p7b')

const profileSetting = (process.env.HARMONY_BUILD_PROFILE ?? '').trim()
const profileRaw = profileSetting.length > 0 ? profileSetting : 'build-profile.json5'
const profileFile = isAbsolute(profileRaw) ? profileRaw : resolve(projectRoot, profileRaw)
if (!existsSync(profileFile)) {
  console.error(`[signing] build profile not found: ${profileFile}`)
  process.exit(1)
}

const config = JSON.parse(readFileSync(profileFile, 'utf8'))
const configNameSetting = (process.env.HARMONY_SIGNING_CONFIG_NAME ?? '').trim()
const configName = configNameSetting.length > 0 ? configNameSetting : 'release'
const signingConfig = {
  name: configName,
  type: 'HarmonyOS',
  material: {
    storePassword: process.env.HARMONY_SIGNING_STORE_PASSWORD,
    storeFile,
    keyAlias: process.env.HARMONY_SIGNING_KEY_ALIAS,
    keyPassword: process.env.HARMONY_SIGNING_KEY_PASSWORD,
    certpath: certPath,
    profile: profilePath,
    signAlg: 'SHA256withECDSA'
  }
}

config.app = config.app ?? {}
const existing = Array.isArray(config.app.signingConfigs) ? config.app.signingConfigs : []
config.app.signingConfigs = [...existing.filter((entry) => entry?.name !== configName), signingConfig]
config.app.products = (config.app.products ?? []).map((product) => ({ ...product, signingConfig: configName }))
writeFileSync(profileFile, `${JSON.stringify(config, null, 2)}\n`)

console.log(`[signing] injected signingConfig "${configName}" for ${config.app.products.length} product(s)`)
console.log(`[signing] material directory: ${outDir}`)
