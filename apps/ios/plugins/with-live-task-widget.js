// The extension target is part of the committed Xcode project. Keep fork signing
// identity and release version in step with the containing app on Expo prebuild.
const { withXcodeProject } = require('expo/config-plugins')

module.exports = config => withXcodeProject(config, mod => {
  const project = mod.modResults
  const widget = project.pbxTargetByName('RemoteTaskWidget')
  if (!widget) throw new Error('Missing committed RemoteTaskWidget target')
  const list = project.pbxXCConfigurationList()[widget.buildConfigurationList]
  for (const { value } of list.buildConfigurations) {
    const settings = project.pbxXCBuildConfigurationSection()[value].buildSettings
    settings.PRODUCT_BUNDLE_IDENTIFIER = config.ios.bundleIdentifier + '.LiveTask'
    settings.MARKETING_VERSION = config.version
    settings.CURRENT_PROJECT_VERSION = config.ios.buildNumber
    if (config.ios.appleTeamId) settings.DEVELOPMENT_TEAM = config.ios.appleTeamId
  }
  return mod
})
