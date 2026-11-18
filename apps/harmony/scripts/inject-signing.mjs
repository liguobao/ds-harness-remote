#!/usr/bin/env node
/**
 * Inject HarmonyOS signing material from CI secrets or a runner-local directory.
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
 *   HARMONY_SIGNING_SOURCE_DIR      runner-local signing files; used only when all
 *                                   six signing secrets are absent
 *   HARMONY_SIGNING_OUT_DIR         where material is written (default: build/signing)
 *   HARMONY_SIGNING_CONFIG_NAME     signingConfig name (default: release)
 *   HARMONY_BUILD_PROFILE           build-profile path (default: build-profile.json5)
 *
 * Use --unsigned to remove signing references without loading secrets.
 * Exit codes: 0 configured, 1 error.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createCipheriv, pbkdf2Sync, randomBytes } from 'node:crypto'

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

const profileSetting = (process.env.HARMONY_BUILD_PROFILE ?? '').trim()
const profileRaw = profileSetting.length > 0 ? profileSetting : 'build-profile.json5'
const profileFile = isAbsolute(profileRaw) ? profileRaw : resolve(projectRoot, profileRaw)
if (!existsSync(profileFile)) {
  console.error('[signing] build profile not found')
  process.exit(1)
}

const config = JSON.parse(readFileSync(profileFile, 'utf8'))
chmodSync(profileFile, 0o600)
if (process.argv.includes('--unsigned')) {
  config.app.signingConfigs = []
  for (const product of config.app.products ?? []) delete product.signingConfig
  writeFileSync(profileFile, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 })
  console.log('[signing] configured an unsigned build')
  process.exit(0)
}

const sourceDir = (process.env.HARMONY_SIGNING_SOURCE_DIR ?? '').trim()
if (sourceDir && REQUIRED.every((name) => (process.env[name] ?? '').length === 0)) {
  if (!isAbsolute(sourceDir)) {
    console.error('[signing] signing source directory must be absolute')
    process.exit(1)
  }
  try {
    const read = (name) => readFileSync(join(sourceDir, name))
    const storePassword = read('store-password.txt').toString('utf8').trimEnd()
    const values = {
      HARMONY_SIGNING_STORE_B64: read('dsh-remote-release.p12').toString('base64'),
      HARMONY_SIGNING_CERT_B64: read('dsh-remote-release.cer').toString('base64'),
      HARMONY_SIGNING_PROFILE_B64: read('dsh-remote-release.p7b').toString('base64'),
      HARMONY_SIGNING_STORE_PASSWORD: storePassword,
      HARMONY_SIGNING_KEY_PASSWORD: read('key-password.txt').toString('utf8').trimEnd(),
      HARMONY_SIGNING_KEY_ALIAS: read('key-alias.txt').toString('utf8').trim()
    }
    Object.assign(process.env, values)
  } catch {
    console.error('[signing] runner-local signing material is missing or unreadable')
    process.exit(1)
  }
}
const missing = REQUIRED.filter((name) => (process.env[name] ?? '').length === 0)
if (missing.length > 0) {
  console.error(`[signing] incomplete signing secrets, missing: ${missing.join(', ')}`)
  process.exit(1)
}

const outDirSetting = (process.env.HARMONY_SIGNING_OUT_DIR ?? '').trim()
const outDirRaw = outDirSetting.length > 0 ? outDirSetting : join(projectRoot, 'build', 'signing')
const outDir = isAbsolute(outDirRaw) ? outDirRaw : resolve(projectRoot, outDirRaw)
mkdirSync(outDir, { recursive: true, mode: 0o700 })

function materialise(envName, fileName) {
  const target = join(outDir, fileName)
  writeFileSync(target, Buffer.from(process.env[envName], 'base64'), { mode: 0o600 })
  chmodSync(target, 0o600)
  return target
}

const storeFile = materialise('HARMONY_SIGNING_STORE_B64', 'upload.p12')
const certPath = materialise('HARMONY_SIGNING_CERT_B64', 'upload.cer')
const profilePath = materialise('HARMONY_SIGNING_PROFILE_B64', 'upload.p7b')

// Match the SDK's DecipherUtil format. These ephemeral wrapping keys live beside
// the copied keystore and are removed with build/signing after the job.
function encryptPasswords(passwords) {
  const material = join(outDir, 'material')
  const writeMaterial = (parts, bytes) => {
    const directory = join(material, ...parts)
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    const file = join(directory, 'value')
    writeFileSync(file, bytes, { mode: 0o600 })
    chmodSync(file, 0o600)
  }
  const components = [randomBytes(16), randomBytes(16), randomBytes(16)]
  components.forEach((bytes, index) => writeMaterial(['fd', String(index)], bytes))
  const mixed = Buffer.from([49, 243, 9, 115, 214, 175, 91, 184, 211, 190, 177, 88, 101, 131, 192, 119])
  for (const bytes of components) for (let index = 0; index < 16; index++) mixed[index] ^= bytes[index]
  const salt = randomBytes(32)
  writeMaterial(['ac'], salt)
  const rootKey = pbkdf2Sync(mixed.toString(), salt, 10000, 16, 'sha256')
  const workKey = randomBytes(16)
  const encrypt = (key, bytes) => {
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-128-gcm', key, iv)
    const encrypted = Buffer.concat([cipher.update(bytes), cipher.final()])
    const length = Buffer.alloc(4)
    length.writeUInt32BE(encrypted.length + 16)
    return Buffer.concat([length, iv, encrypted, cipher.getAuthTag()])
  }
  writeMaterial(['ce'], encrypt(rootKey, workKey))
  return passwords.map((password) => encrypt(workKey, Buffer.from(password, 'utf8')).toString('hex'))
}
const [storePassword, keyPassword] = encryptPasswords([
  process.env.HARMONY_SIGNING_STORE_PASSWORD,
  process.env.HARMONY_SIGNING_KEY_PASSWORD
])

const configNameSetting = (process.env.HARMONY_SIGNING_CONFIG_NAME ?? '').trim()
const configName = configNameSetting.length > 0 ? configNameSetting : 'release'
const signingConfig = {
  name: configName,
  type: 'HarmonyOS',
  material: {
    storePassword,
    storeFile,
    keyAlias: process.env.HARMONY_SIGNING_KEY_ALIAS,
    keyPassword,
    certpath: certPath,
    profile: profilePath,
    signAlg: 'SHA256withECDSA'
  }
}

config.app = config.app ?? {}
const existing = Array.isArray(config.app.signingConfigs) ? config.app.signingConfigs : []
config.app.signingConfigs = [...existing.filter((entry) => entry?.name !== configName), signingConfig]
config.app.products = (config.app.products ?? []).map((product) => ({ ...product, signingConfig: configName }))
writeFileSync(profileFile, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 })

console.log(`[signing] injected signingConfig "${configName}" for ${config.app.products.length} product(s)`)
