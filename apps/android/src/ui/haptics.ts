import * as Haptics from 'expo-haptics'

/** Trigger a light tactile tap without propagating unsupported-device errors. */
export function triggerLightHaptic(): void {
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined)
}
