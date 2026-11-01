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
      'android.permission.ACCESS_WIFI_STATE',
      'android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS',
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

    // Native text selection toolbar action: 询问智能体 (android.intent.action.PROCESS_TEXT)
    application['activity-alias'] ??= []
    const aliasObj = {
      $: {
        'android:name': '.AskAgentProcessTextActivity',
        'android:targetActivity': '.MainActivity',
        'android:label': '@string/ask_agent_process_text',
        'android:exported': 'true',
      },
      'intent-filter': [
        {
          $: {
            'android:priority': '2147483647',
          },
          action: [{ $: { 'android:name': 'android.intent.action.PROCESS_TEXT' } }],
          category: [{ $: { 'android:name': 'android.intent.category.DEFAULT' } }],
          data: [{ $: { 'android:mimeType': 'text/plain' } }],
        },
      ],
    }
    const existingAliasIndex = application['activity-alias'].findIndex(item => item.$?.['android:name'] === '.AskAgentProcessTextActivity')
    if (existingAliasIndex >= 0) {
      application['activity-alias'][existingAliasIndex] = aliasObj
    } else {
      application['activity-alias'].push(aliasObj)
    }
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

    // Localized strings for PROCESS_TEXT selection action
    const resDir = path.join(config.modRequest.platformProjectRoot, 'app', 'src', 'main', 'res')
    const stringLocales = {
      'values': 'Ask Agent',
      'values-zh': '询问智能体',
      'values-zh-rCN': '询问智能体',
      'values-zh-rTW': '詢問智慧體',
      'values-zh-rHK': '詢問智慧體',
      'values-ja': 'エージェントに質問',
      'values-es': 'Preguntar al agente',
      'values-fr': "Demander à l\\'agent",
      'values-de': 'Agent fragen',
    }

    for (const [folder, text] of Object.entries(stringLocales)) {
      const targetDir = path.join(resDir, folder)
      fs.mkdirSync(targetDir, { recursive: true })
      const stringsFile = path.join(targetDir, 'strings.xml')
      if (fs.existsSync(stringsFile)) {
        let content = fs.readFileSync(stringsFile, 'utf8')
        if (content.includes('name="ask_agent_process_text"')) {
          content = content.replace(/<string name="ask_agent_process_text">.*?<\/string>/s, `<string name="ask_agent_process_text">${text}</string>`)
        } else {
          content = content.replace('</resources>', `  <string name="ask_agent_process_text">${text}</string>\n</resources>`)
        }
        fs.writeFileSync(stringsFile, content, 'utf8')
      } else {
        const content = `<resources>\n  <string name="ask_agent_process_text">${text}</string>\n</resources>\n`
        fs.writeFileSync(stringsFile, content, 'utf8')
      }
    }

    return config
  }])
}

module.exports = withRemoteForegroundService

