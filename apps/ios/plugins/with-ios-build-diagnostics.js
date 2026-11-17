const { withPodfile } = require('expo/config-plugins')
const { mergeContents } = require('@expo/config-plugins/build/utils/generateCode')

// Hermes swaps the installed framework according to the active configuration.
// It intentionally runs every time; fake outputs would risk reusing the wrong
// binary when changing Debug/Release. Mark that intent in the generated Pods.
module.exports = function withIosBuildDiagnostics(config) {
  return withPodfile(config, config => {
    config.modResults.contents = mergeContents({
      tag: 'dsh-hermes-build-phase',
      src: config.modResults.contents,
      newSrc: `    installer.pods_project.targets.each do |target|
      next unless target.name == 'hermes-engine'
      target.shell_script_build_phases.each do |phase|
        if phase.name == '[CP-User] [Hermes] Replace Hermes for the right configuration, if needed'
          phase.always_out_of_date = '1'
        end
      end
    end`,
      anchor: /post_install do \|installer\|/,
      offset: 1,
      comment: '#',
    }).contents
    return config
  })
}
