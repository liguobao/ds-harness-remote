const fs = require('node:fs')
const path = require('node:path')
const {
  withAndroidManifest,
  withDangerousMod,
  withMainActivity,
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
            'android:priority': '1000',
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

  config = withMainActivity(config, config => {
    const onActionModeSnippet = `
  override fun onActionModeStarted(mode: android.view.ActionMode?) {
    super.onActionModeStarted(mode)
    val menu = mode?.menu ?: return
    try {
      var askAgentItem: android.view.MenuItem? = null
      var copyItem: android.view.MenuItem? = null
      var translateItem: android.view.MenuItem? = null

      for (i in 0 until menu.size()) {
        val item = menu.getItem(i)
        val title = item.title?.toString() ?: ""
        val intentClass = item.intent?.component?.className ?: ""
        if (intentClass.contains("AskAgent") || title == "询问智能体" || title == "Ask Agent" || title == "詢問智慧體" || title == "エージェントに質問") {
          askAgentItem = item
        } else if (item.itemId == android.R.id.copy || title == "Copy" || title == "复制" || title == "複製") {
          copyItem = item
        } else if (title.contains("Translate") || title.contains("翻译") || title.contains("翻譯")) {
          translateItem = item
        }
      }

      if (translateItem != null) {
        val title = translateItem.title
        val intent = translateItem.intent
        val icon = translateItem.icon
        val itemId = translateItem.itemId
        menu.removeItem(itemId)
        val newTrans = menu.add(android.view.Menu.NONE, itemId, 999, title)
        newTrans.intent = intent
        newTrans.icon = icon
        newTrans.setShowAsAction(android.view.MenuItem.SHOW_AS_ACTION_NEVER)
      }

      if (askAgentItem != null) {
        val title = askAgentItem.title
        val intent = askAgentItem.intent
        val icon = askAgentItem.icon
        val itemId = askAgentItem.itemId
        menu.removeItem(itemId)
        val newAsk = menu.add(android.view.Menu.NONE, itemId, 0, title)
        newAsk.intent = intent
        newAsk.icon = icon
        newAsk.setShowAsAction(android.view.MenuItem.SHOW_AS_ACTION_ALWAYS)
      }

      if (copyItem != null) {
        copyItem.setShowAsAction(android.view.MenuItem.SHOW_AS_ACTION_ALWAYS)
      }
    } catch (_: Throwable) {}
  }
`
    if (!config.modResults.contents.includes('override fun onActionModeStarted')) {
      const lastBrace = config.modResults.contents.lastIndexOf('}')
      if (lastBrace > 0) {
        config.modResults.contents = config.modResults.contents.slice(0, lastBrace) + onActionModeSnippet + '\n}\n'
      }
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

