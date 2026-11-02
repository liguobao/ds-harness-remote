import { AbilityConstant, Configuration, ConfigurationConstant, UIAbility, Want } from '@kit.AbilityKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { window } from '@kit.ArkUI';
import { getAppRuntime } from '../services/AppRuntime';

const DOMAIN = 0x0000;
const BG_DARK = '#070B16';
const BG_LIGHT = '#F2F5FA';
const CONTENT_DARK = '#F2F4FA';
const CONTENT_LIGHT = '#1B2437';

export default class EntryAbility extends UIAbility {
  private mainWindow: window.Window | undefined = undefined;

  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    try {
      this.context.getApplicationContext().setColorMode(ConfigurationConstant.ColorMode.COLOR_MODE_NOT_SET);
    } catch (err) {
      hilog.error(DOMAIN, 'testTag', 'Failed to set colorMode. Cause: %{public}s', JSON.stringify(err));
    }
    const runtime = getAppRuntime();
    runtime.setSystemDark(this.context.config.colorMode === ConfigurationConstant.ColorMode.COLOR_MODE_DARK);
    runtime.setSystemLandscape(this.context.config.direction === ConfigurationConstant.Direction.DIRECTION_HORIZONTAL);
    hilog.info(DOMAIN, 'testTag', '%{public}s', 'Ability onCreate');
  }

  onDestroy(): void {
    hilog.info(DOMAIN, 'testTag', '%{public}s', 'Ability onDestroy');
  }

  onWindowStageCreate(windowStage: window.WindowStage): void {
    // Main window is created, set main page for this ability
    hilog.info(DOMAIN, 'testTag', '%{public}s', 'Ability onWindowStageCreate');

    this.mainWindow = windowStage.getMainWindowSync();
    this.applyWindowTheme();
    windowStage.loadContent('pages/Index', (err) => {
      if (err.code) {
        hilog.error(DOMAIN, 'testTag', 'Failed to load the content. Cause: %{public}s', JSON.stringify(err));
        return;
      }
      // Re-assert after content load: some devices drop the pre-load values.
      this.applyWindowTheme();
      hilog.info(DOMAIN, 'testTag', 'Succeeded in loading the content.');
    });
  }

  /** Immersive layout plus window/bar colors matching the active theme. */
  private applyWindowTheme(): void {
    const win: window.Window | undefined = this.mainWindow;
    if (win === undefined) {
      return;
    }
    const dark: boolean = getAppRuntime().isDark();
    const bg: string = dark ? BG_DARK : BG_LIGHT;
    const content: string = dark ? CONTENT_DARK : CONTENT_LIGHT;
    try {
      win.setWindowBackgroundColor(bg);
      win.setWindowLayoutFullScreen(true);
      win.setWindowSystemBarProperties({
        statusBarColor: bg,
        statusBarContentColor: content,
        navigationBarColor: bg,
        navigationBarContentColor: content
      }).catch(() => {
        hilog.warn(DOMAIN, 'testTag', '%{public}s', 'setWindowSystemBarProperties rejected');
      });
    } catch (err) {
      hilog.warn(DOMAIN, 'testTag', 'immersive not supported: %{public}s', JSON.stringify(err));
    }
  }

  onConfigurationUpdate(newConfig: Configuration): void {
    const runtime = getAppRuntime();
    runtime.setSystemDark(newConfig.colorMode === ConfigurationConstant.ColorMode.COLOR_MODE_DARK);
    runtime.setSystemLandscape(newConfig.direction === ConfigurationConstant.Direction.DIRECTION_HORIZONTAL);
    this.applyWindowTheme();
  }

  onWindowStageDestroy(): void {
    // Main window is destroyed, release UI related resources
    hilog.info(DOMAIN, 'testTag', '%{public}s', 'Ability onWindowStageDestroy');
  }

  onForeground(): void {
    // Ability has brought to foreground
    hilog.info(DOMAIN, 'testTag', '%{public}s', 'Ability onForeground');
  }

  onBackground(): void {
    // Ability has back to background
    hilog.info(DOMAIN, 'testTag', '%{public}s', 'Ability onBackground');
  }
}
