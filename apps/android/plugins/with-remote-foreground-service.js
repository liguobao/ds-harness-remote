const fs = require('node:fs')
const path = require('node:path')
const {
  withAndroidManifest,
  withDangerousMod,
  withMainApplication,
} = require('@expo/config-plugins')

const PACKAGE = 'io.github.liguobao.dshremote'
const JAVA_PATH = PACKAGE.replaceAll('.', path.sep)
const SOURCE_DIR = path.join(__dirname, 'remote-foreground-service')

function withRemoteForegroundService(config) {
  config = withAndroidManifest(config, config => {
    const manifest = config.modResults.manifest
    manifest['uses-permission'] ??= []
    const permissions = new Set(manifest['uses-permission'].map(item => item.$?.['android:name']))
    for (const name of [
      'android.permission.FOREGROUND_SERVICE',
      'android.permission.FOREGROUND_SERVICE_REMOTE_MESSAGING',
      'android.permission.POST_NOTIFICATIONS',
      'android.permission.WAKE_LOCK',
    ]) {
      if (!permissions.has(name)) manifest['uses-permission'].push({ $: { 'android:name': name } })
    }
    const application = manifest.application?.[0]
    if (application === undefined) throw new Error('Android application manifest entry is missing')
    const services = application.service ?? []
    if (!services.some(item => item.$?.['android:name'] === `.${'RemoteForegroundService'}`)) {
      services.push({ $: {
        'android:name': '.RemoteForegroundService',
        'android:exported': 'false',
        'android:foregroundServiceType': 'remoteMessaging',
      } })
    }
    application.service = services
    return config
  })

  config = withMainApplication(config, config => {
    const marker = 'add(RemoteForegroundServicePackage())'
    if (!config.modResults.contents.includes(marker)) {
      const anchor = 'PackageList(this).packages.apply {'
      if (!config.modResults.contents.includes(anchor)) throw new Error('MainApplication package list anchor is missing')
      config.modResults.contents = config.modResults.contents.replace(anchor, `${anchor}\n          ${marker}`)
    }
    return config
  })

  return withDangerousMod(config, ['android', async config => {
    const destination = path.join(config.modRequest.platformProjectRoot, 'app', 'src', 'main', 'java', JAVA_PATH)
    fs.mkdirSync(destination, { recursive: true })
    for (const file of fs.readdirSync(SOURCE_DIR)) {
      fs.copyFileSync(path.join(SOURCE_DIR, file), path.join(destination, file))
    }
    return config
  }])
}

module.exports = withRemoteForegroundService

