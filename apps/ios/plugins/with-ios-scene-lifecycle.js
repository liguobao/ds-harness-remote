const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const { withAppDelegate } = require('expo/config-plugins')

const MARKER = '// DSH iOS scene lifecycle'
const sceneSource = readFileSync(join(__dirname, 'ios-scene-lifecycle.swift'), 'utf8')

function applySceneLifecycle(source) {
  if (source.includes(MARKER)) {
    // Refresh our generated section on every prebuild so future lifecycle
    // fixes in the Swift source also reach an existing native project.
    return source.slice(0, source.indexOf(MARKER)).trimEnd() + '\n\n' + MARKER + '\n' + sceneSource
  }

  // SDK 57's template still starts React Native in a window without a scene.
  // Retain the factory setup, but defer window creation until UIKit connects
  // the UIWindowScene. Fail generation if the template changes underneath us.
  const legacyStartup = /#if os\(iOS\) \|\| os\(tvOS\)\s+window = UIWindow\(frame: UIScreen\.main\.bounds\)\s+factory\.startReactNative\([\s\S]*?launchOptions: launchOptions\)\s+#endif/
  if (!legacyStartup.test(source) || !source.includes('  var reactNativeFactory: RCTReactNativeFactory?\n')) {
    throw new Error('DSH scene lifecycle: unsupported AppDelegate startup; review the Expo template')
  }
  source = source.replace(legacyStartup, '    dshRemoteLaunchOptions = launchOptions')
  source = source.replace(
    '  var reactNativeFactory: RCTReactNativeFactory?\n',
    '  var reactNativeFactory: RCTReactNativeFactory?\n  fileprivate var dshRemoteLaunchOptions: [UIApplication.LaunchOptionsKey: Any]?\n',
  )
  if (!source.includes('import UIKit')) {
    source = source.replace('internal import Expo\n', 'internal import Expo\nimport UIKit\n')
  }
  return source.trimEnd() + '\n\n' + MARKER + '\n' + sceneSource
}

module.exports = function withIosSceneLifecycle(config) {
  return withAppDelegate(config, config => {
    if (config.modResults.language !== 'swift') {
      throw new Error('DSH scene lifecycle requires a Swift AppDelegate')
    }
    config.modResults.contents = applySceneLifecycle(config.modResults.contents)
    return config
  })
}

module.exports.applySceneLifecycle = applySceneLifecycle
