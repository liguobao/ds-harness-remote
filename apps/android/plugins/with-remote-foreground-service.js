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

const stringLocales = {
  'values': {
    ask_agent_process_text: 'Ask Agent',
    live_task_time_just_now: 'Just now',
    live_task_time_minutes_ago: '%1$d min ago',
    live_task_time_hours_ago: '%1$d hr ago',
    live_task_time_days_ago: '%1$d d ago',
    live_task_status_running: 'Running',
    live_task_status_waiting: 'Waiting',
  },
  'values-zh': {
    ask_agent_process_text: '询问智能体',
    live_task_time_just_now: '刚刚',
    live_task_time_minutes_ago: '%1$d 分钟前',
    live_task_time_hours_ago: '%1$d 小时前',
    live_task_time_days_ago: '%1$d 天前',
    live_task_status_running: '运行中',
    live_task_status_waiting: '待确认',
  },
  'values-zh-rCN': {
    ask_agent_process_text: '询问智能体',
    live_task_time_just_now: '刚刚',
    live_task_time_minutes_ago: '%1$d 分钟前',
    live_task_time_hours_ago: '%1$d 小时前',
    live_task_time_days_ago: '%1$d 天前',
    live_task_status_running: '运行中',
    live_task_status_waiting: '待确认',
  },
  'values-zh-rTW': {
    ask_agent_process_text: '詢問智慧體',
    live_task_time_just_now: '剛剛',
    live_task_time_minutes_ago: '%1$d 分鐘前',
    live_task_time_hours_ago: '%1$d 小時前',
    live_task_time_days_ago: '%1$d 天前',
    live_task_status_running: '運行中',
    live_task_status_waiting: '待確認',
  },
  'values-zh-rHK': {
    ask_agent_process_text: '詢問智慧體',
    live_task_time_just_now: '剛剛',
    live_task_time_minutes_ago: '%1$d 分鐘前',
    live_task_time_hours_ago: '%1$d 小時前',
    live_task_time_days_ago: '%1$d 天前',
    live_task_status_running: '運行中',
    live_task_status_waiting: '待確認',
  },
  'values-ja': {
    ask_agent_process_text: 'エージェントに質問',
    live_task_time_just_now: 'たった今',
    live_task_time_minutes_ago: '%1$d分前',
    live_task_time_hours_ago: '%1$d時間前',
    live_task_time_days_ago: '%1$d日前',
    live_task_status_running: '実行中',
    live_task_status_waiting: '確認待ち',
  },
  'values-es': {
    ask_agent_process_text: 'Preguntar al agente',
    live_task_time_just_now: 'Ahora mismo',
    live_task_time_minutes_ago: 'Hace %1$d min',
    live_task_time_hours_ago: 'Hace %1$d h',
    live_task_time_days_ago: 'Hace %1$d d',
    live_task_status_running: 'En ejecución',
    live_task_status_waiting: 'Esperando',
  },
  'values-fr': {
    ask_agent_process_text: '"Demander à l\x27agent"',
    live_task_time_just_now: '"À l\x27instant"',
    live_task_time_minutes_ago: 'Il y a %1$d min',
    live_task_time_hours_ago: 'Il y a %1$d h',
    live_task_time_days_ago: 'Il y a %1$d j',
    live_task_status_running: 'En cours',
    live_task_status_waiting: 'En attente',
  },
  'values-de': {
    ask_agent_process_text: 'Agent fragen',
    live_task_time_just_now: 'Gerade eben',
    live_task_time_minutes_ago: 'Vor %1$d Min.',
    live_task_time_hours_ago: 'Vor %1$d Std.',
    live_task_time_days_ago: 'Vor %1$d T.',
    live_task_status_running: 'Wird ausgeführt',
    live_task_status_waiting: 'Wartend',
  },
}

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
  private fun reorderActionModeMenu(menu: android.view.Menu) {
    try {
      var askAgentItem: android.view.MenuItem? = null
      var copyItem: android.view.MenuItem? = null
      val otherItems = mutableListOf<Triple<Int, CharSequence?, android.content.Intent?>>()

      for (i in 0 until menu.size()) {
        val item = menu.getItem(i)
        val title = item.title?.toString() ?: ""
        val intentClass = item.intent?.component?.className ?: ""
        val isAskAgent = intentClass.contains("AskAgent") ||
          title == "询问智能体" || title == "Ask Agent" || title == "詢問智慧體" || title == "エージェントに質問" ||
          title == "Preguntar al agente" || title.contains("Demander") || title == "Agent fragen"
        val isCopy = item.itemId == android.R.id.copy || title == "Copy" || title == "复制" || title == "複製"

        if (isAskAgent) {
          askAgentItem = item
        } else if (isCopy) {
          copyItem = item
        } else {
          otherItems.add(Triple(item.itemId, item.title, item.intent))
        }
      }

      for ((id, title, intent) in otherItems) {
        menu.removeItem(id)
        if (title != null) {
          val overflowItem = menu.add(android.view.Menu.NONE, id, 100, title)
          overflowItem.intent = intent
          overflowItem.setShowAsAction(android.view.MenuItem.SHOW_AS_ACTION_NEVER)
        }
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
        val title = copyItem.title
        val intent = copyItem.intent
        val icon = copyItem.icon
        val itemId = copyItem.itemId
        menu.removeItem(itemId)
        val newCopy = menu.add(android.view.Menu.NONE, itemId, 1, title)
        newCopy.intent = intent
        newCopy.icon = icon
        newCopy.setShowAsAction(android.view.MenuItem.SHOW_AS_ACTION_ALWAYS)
      }
    } catch (_: Throwable) {}
  }

  override fun onActionModeStarted(mode: android.view.ActionMode?) {
    super.onActionModeStarted(mode)
    mode?.menu?.let { reorderActionModeMenu(it) }
  }

  override fun onWindowStartingActionMode(callback: android.view.ActionMode.Callback?, type: Int): android.view.ActionMode? {
    if (callback != null && type == android.view.ActionMode.TYPE_FLOATING) {
      val wrappedCallback = object : android.view.ActionMode.Callback2() {
        override fun onCreateActionMode(mode: android.view.ActionMode?, menu: android.view.Menu?): Boolean {
          return callback.onCreateActionMode(mode, menu)
        }
        override fun onPrepareActionMode(mode: android.view.ActionMode?, menu: android.view.Menu?): Boolean {
          val result = callback.onPrepareActionMode(mode, menu)
          if (menu != null) {
            reorderActionModeMenu(menu)
          }
          return result
        }
        override fun onActionItemClicked(mode: android.view.ActionMode?, item: android.view.MenuItem?): Boolean {
          return callback.onActionItemClicked(mode, item)
        }
        override fun onDestroyActionMode(mode: android.view.ActionMode?) {
          callback.onDestroyActionMode(mode)
        }
        override fun onGetContentRect(mode: android.view.ActionMode?, view: android.view.View?, outRect: android.graphics.Rect?) {
          if (callback is android.view.ActionMode.Callback2) {
            callback.onGetContentRect(mode, view, outRect)
          }
        }
      }
      return super.onWindowStartingActionMode(wrappedCallback, type)
    }
    return super.onWindowStartingActionMode(callback, type)
  }
`
    if (!config.modResults.contents.includes('onWindowStartingActionMode')) {
      if (config.modResults.contents.includes('override fun onActionModeStarted')) {
        const startIdx = config.modResults.contents.indexOf('override fun onActionModeStarted')
        const lastBrace = config.modResults.contents.lastIndexOf('}')
        if (startIdx > 0 && lastBrace > startIdx) {
          config.modResults.contents = config.modResults.contents.slice(0, startIdx) + onActionModeSnippet + '\n}\n'
        }
      } else {
        const lastBrace = config.modResults.contents.lastIndexOf('}')
        if (lastBrace > 0) {
          config.modResults.contents = config.modResults.contents.slice(0, lastBrace) + onActionModeSnippet + '\n}\n'
        }
      }
    }
    return config
  })

  return withDangerousMod(config, ['android', async config => {
    const destination = path.join(config.modRequest.platformProjectRoot, 'app', 'src', 'main', 'java', JAVA_PATH)
    fs.mkdirSync(destination, { recursive: true })
    for (const file of fs.readdirSync(SOURCE_DIR)) {
      const srcFile = path.join(SOURCE_DIR, file)
      if (fs.statSync(srcFile).isFile()) {
        fs.copyFileSync(srcFile, path.join(destination, file))
      }
    }

    const resDir = path.join(config.modRequest.platformProjectRoot, 'app', 'src', 'main', 'res')
    const srcResDir = path.join(SOURCE_DIR, 'res')
    if (fs.existsSync(srcResDir)) {
      const copyDir = (src, dest) => {
        fs.mkdirSync(dest, { recursive: true })
        for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
          const s = path.join(src, entry.name)
          const d = path.join(dest, entry.name)
          if (entry.isDirectory()) copyDir(s, d)
          else fs.copyFileSync(s, d)
        }
      }
      copyDir(srcResDir, resDir)
    }

    for (const [folder, stringsMap] of Object.entries(stringLocales)) {
      const targetDir = path.join(resDir, folder)
      fs.mkdirSync(targetDir, { recursive: true })
      const stringsFile = path.join(targetDir, 'strings.xml')
      let content = fs.existsSync(stringsFile)
        ? fs.readFileSync(stringsFile, 'utf8')
        : '<resources>\n</resources>\n'
      for (const [key, text] of Object.entries(stringsMap)) {
        const regex = new RegExp(`<string name="${key}">.*?</string>`, 's')
        if (regex.test(content)) {
          content = content.replace(regex, () => `<string name="${key}">${text}</string>`)
        } else {
          content = content.replace('</resources>', () => `  <string name="${key}">${text}</string>\n</resources>`)
        }
      }
      fs.writeFileSync(stringsFile, content, 'utf8')
    }

    return config
  }])
}

withRemoteForegroundService.stringLocales = stringLocales

module.exports = withRemoteForegroundService

