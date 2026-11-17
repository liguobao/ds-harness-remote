const { withAppDelegate } = require('expo/config-plugins')

const MARKER = 'DSH background connection grace'

/**
 * Give the native WebSocket a short iOS background execution grace period.
 * This is intentionally not a UIBackgroundModes declaration: iOS does not
 * provide a general-purpose, indefinite background mode for WebSockets.
 */
module.exports = function withBackgroundConnectionGrace(config) {
  return withAppDelegate(config, config => {
    let source = config.modResults.contents
    if (source.includes(MARKER)) return config

    if (!source.includes('import UIKit')) {
      source = source.replace('internal import Expo\n', 'internal import Expo\nimport UIKit\n')
    }

    const property = `\n  // ${MARKER}\n  private var dshRemoteBackgroundTask: UIBackgroundTaskIdentifier = .invalid\n`
    source = source.replace('  var reactNativeFactory: RCTReactNativeFactory?\n', '  var reactNativeFactory: RCTReactNativeFactory?\n' + property)

    const lifecycle = `\n  public override func applicationDidEnterBackground(_ application: UIApplication) {\n    super.applicationDidEnterBackground(application)\n    guard dshRemoteBackgroundTask == .invalid else { return }\n    dshRemoteBackgroundTask = application.beginBackgroundTask(withName: "DSH Remote connection grace") { [weak self] in\n      self?.endDshRemoteBackgroundTask(application)\n    }\n  }\n\n  public override func applicationWillEnterForeground(_ application: UIApplication) {\n    endDshRemoteBackgroundTask(application)\n    super.applicationWillEnterForeground(application)\n  }\n\n  private func endDshRemoteBackgroundTask(_ application: UIApplication) {\n    guard dshRemoteBackgroundTask != .invalid else { return }\n    application.endBackgroundTask(dshRemoteBackgroundTask)\n    dshRemoteBackgroundTask = .invalid\n  }\n`
    source = source.replace('\n  // Linking API\n', lifecycle + '\n  // Linking API\n')
    config.modResults.contents = source
    return config
  })
}
