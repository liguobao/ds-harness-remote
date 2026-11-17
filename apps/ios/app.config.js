// Dynamic Expo config for the public repository.
//
// The Apple team, bundle identifier and server URL are deployment identity, not
// source code: a fork must be able to build this app with its own Apple
// account, and this repository is public. They are read from the environment
// (GitHub Actions secrets/variables in CI) and fall back to values that are
// safe to publish.
//
// EXPO_PUBLIC_* variables are inlined into the JS bundle by Expo and are
// therefore NOT secrets. Only APPLE_TEAM_ID is signing identity; the real
// secrets (certificate, provisioning profile, App Store Connect API key) never
// reach app config and are handled by the signing step in CI.
const appJson = require('./app.json')

const bundleIdentifier = process.env.DSH_IOS_BUNDLE_IDENTIFIER || appJson.expo.ios.bundleIdentifier
const appleTeamId = process.env.APPLE_TEAM_ID || undefined

module.exports = ({ config }) => {
  const base = { ...config, ...appJson.expo }

  return {
    ...base,
    ios: {
      ...base.ios,
      bundleIdentifier,
      // Omitted entirely when unset: an unsigned compile-verification build
      // must not carry an empty DEVELOPMENT_TEAM into the generated project.
      ...(appleTeamId ? { appleTeamId } : {}),
    },
  }
}
