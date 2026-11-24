const { withXcodeProject } = require('expo/config-plugins')

const name = 'HostAttentionWidget'

module.exports = config => withXcodeProject(config, config => {
  const project = config.modResults
  const objects = project.hash.project.objects
  let target = Object.values(project.pbxNativeTargetSection()).find(
    entry => entry.name?.replaceAll('"', '') === name,
  )
  if (!target) {
    objects.PBXContainerItemProxy ??= {}
    objects.PBXTargetDependency ??= {}
    const widget = project.addTarget(name, 'app_extension', name)
    project.addBuildPhase([
      '../plugins/attention-widget/HostAttentionWidget.swift',
      '../modules/remote-native/apple/HostAttentionAttributes.swift',
    ], 'PBXSourcesBuildPhase', 'Sources', widget.uuid)
    target = widget.pbxNativeTarget
  }
  // xcode's addBuildPhase creates ungrouped file references. Xcode resolves
  // relative Swift sources through the main group and needs their Swift type.
  const mainGroup = objects.PBXGroup[project.getFirstProject().firstProject.mainGroup]
  const sources = objects.PBXSourcesBuildPhase[target.buildPhases[0].value]
  for (const file of sources.files) {
    const ref = objects.PBXBuildFile[file.value].fileRef
    delete objects.PBXFileReference[ref].explicitFileType
    if (!mainGroup.children.some(child => child.value === ref)) {
      mainGroup.children.push({ value: ref, comment: objects.PBXFileReference[ref].name })
    }
  }
  const product = objects.PBXFileReference[target.productReference]
  delete product.lastKnownFileType
  delete product.fileEncoding
  const configs = objects.XCConfigurationList[target.buildConfigurationList].buildConfigurations
  for (const { value } of configs) {
    const settings = objects.XCBuildConfiguration[value].buildSettings
    Object.assign(settings, {
      APPLICATION_EXTENSION_API_ONLY: 'YES',
      GENERATE_INFOPLIST_FILE: 'YES',
      INFOPLIST_FILE: '"../plugins/attention-widget/Info.plist"',
      IPHONEOS_DEPLOYMENT_TARGET: '16.4',
      PRODUCT_BUNDLE_IDENTIFIER: config.ios.bundleIdentifier + '.attention',
      MARKETING_VERSION: config.version,
      CURRENT_PROJECT_VERSION: config.ios.buildNumber,
      SWIFT_VERSION: '5.0',
      TARGETED_DEVICE_FAMILY: '"1,2"',
    })
    if (config.ios.appleTeamId) settings.DEVELOPMENT_TEAM = config.ios.appleTeamId
    else delete settings.DEVELOPMENT_TEAM
  }
  return config
})
