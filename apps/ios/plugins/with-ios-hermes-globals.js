const { existsSync, readFileSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')
const { withDangerousMod } = require('expo/config-plugins')

// `expo prebuild` writes a fresh ios/.xcode.env from the Expo template, so the
// custom Hermes compiler path cannot live in a committed file here: the public
// repository generates ios/ in CI instead of tracking it. Re-apply the setting
// on every prebuild.
//
// scripts/hermesc-with-globals.sh wraps hermesc with -include-globals so the
// bundler keeps undefined-variable diagnostics enabled while still declaring
// the globals React Native installs at runtime. Without it, a Release build
// either loses those diagnostics or fails on legitimate runtime globals.
const MARKER = '# DSH Hermes compiler globals'
const SETTING = 'export HERMES_CLI_PATH="$PODS_ROOT/../../scripts/hermesc-with-globals.sh"'

module.exports = function withIosHermesGlobals(config) {
  return withDangerousMod(config, [
    'ios',
    config => {
      const envPath = join(config.modRequest.platformProjectRoot, '.xcode.env')
      if (!existsSync(envPath)) {
        throw new Error('DSH Hermes globals: ios/.xcode.env is missing; review the Expo template')
      }

      const contents = readFileSync(envPath, 'utf8')
      if (contents.includes(MARKER)) return config

      const wrapper = join(config.modRequest.projectRoot, 'scripts', 'hermesc-with-globals.sh')
      if (!existsSync(wrapper)) {
        throw new Error(`DSH Hermes globals: missing wrapper script at ${wrapper}`)
      }

      writeFileSync(envPath, `${contents.trimEnd()}\n\n${MARKER}\n${SETTING}\n`)
      return config
    },
  ])
}
