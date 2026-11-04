/**
 * 极轻量的界面文案表。
 *
 * 这里刻意不走 `$r('app.string.*')`：客户端大量文案是在方法里拼出来的
 * （相对时间、步骤数、版本号），Resource 只能在 build 里用，返回不了 string。
 * 所以以「中文原文」为 key，英文命中就替换，未命中回落中文——
 * 这样新增文案不用先建资源条目，也不会因为漏翻而显示成空白。
 */

import { i18n } from '@kit.LocalizationKit';

/** 语言偏好：0 跟随系统，1 中文，2 English。 */
export const LANG_SYSTEM: number = 0;
export const LANG_ZH: number = 1;
export const LANG_EN: number = 2;

let englishActive: boolean = false;

/** 系统是不是英文环境（取不到时按中文处理）。 */
export function systemEnglish(): boolean {
  try {
    const tag: string = i18n.System.getSystemLanguage().toLowerCase();
    return tag.startsWith('en');
  } catch (error) {
    return false;
  }
}

export function resolveEnglish(mode: number, systemIsEnglish: boolean): boolean {
  if (mode === LANG_ZH) {
    return false;
  }
  if (mode === LANG_EN) {
    return true;
  }
  return systemIsEnglish;
}

export function setEnglish(value: boolean): void {
  englishActive = value;
}

export function english(): boolean {
  return englishActive;
}

export function t(zh: string): string {
  if (!englishActive) {
    return zh;
  }
  const hit: string | undefined = EN.get(zh);
  return hit === undefined ? zh : hit;
}

function buildEnglish(): Map<string, string> {
  const map: Map<string, string> = new Map<string, string>();
  // —— 登录 / 授权 ——
  map.set('连接你的 DEEPSEEK HARNESS 主机', 'Connect to your DEEPSEEK HARNESS host');
  map.set('服务器地址（https://…）', 'Server URL (https://…)');
  map.set('邮箱', 'Email');
  map.set('密码', 'Password');
  map.set('登录', 'Sign in');
  map.set('扫码 / 浏览器授权登录', 'Sign in with QR / browser');
  map.set('扫码 / 浏览器授权登录（选账号对应的提供商）', 'Sign in with QR / browser (pick your provider)');
  map.set('用已登录同一账号的浏览器扫码或点按钮授权', 'Scan with a browser signed in to the same account, or tap to authorize');
  map.set('在浏览器中打开授权页', 'Open the authorization page in a browser');
  map.set('复制授权链接', 'Copy authorization link');
  map.set('等待浏览器授权…', 'Waiting for browser authorization…');
  // —— 通用动作 ——
  map.set('取消', 'Cancel');
  map.set('确定', 'OK');
  map.set('完成', 'Done');
  map.set('连接', 'Connect');
  map.set('改名', 'Rename');
  map.set('重试', 'Retry');
  // —— 设备页 ——
  map.set('远程主机', 'Remote hosts');
  map.set('在线', 'online');
  map.set('离线', 'offline');
  map.set('正在刷新设备…', 'Refreshing hosts…');
  map.set('暂无远程主机，请先在服务器上注册主机设备', 'No remote host yet — register one on the server first');
  map.set('输入主机名称', 'Host name');
  map.set('该主机已固定公钥', 'This host is pinned');
  map.set('清除后下次连接将重新信任首次看到的公钥。',
    'After clearing, the next connection trusts whatever key it sees first.');
  map.set('清除固定记录', 'Clear pin');
  map.set('已清除该主机的公钥固定记录', 'Host key pin cleared');
  map.set('此刻在线', 'online now');
  map.set('离线 · 无活动记录', 'offline · no activity');
  map.set('离线 · 刚刚还在', 'offline · just now');
  map.set('主机', 'host');
  map.set('插件', 'plugin');
  map.set('退出登录', 'Sign out');
  map.set('将清除本机保存的主机凭据，需要重新绑定才能连接。',
    'This clears the saved host credentials on this device; you will need to pair again.');
  map.set('退出', 'Sign out');
  // —— 设置面板 ——
  map.set('设置', 'Settings');
  map.set('外观', 'Appearance');
  map.set('语言', 'Language');
  map.set('跟随系统', 'Follow system');
  map.set('浅色', 'Light');
  map.set('深色', 'Dark');
  map.set('中文', '中文');
  map.set('跟着系统的深浅色走', 'Match the system light/dark setting');
  map.set('始终使用浅色界面', 'Always use the light theme');
  map.set('始终使用深色界面', 'Always use the dark theme');
  map.set('跟着系统语言走', 'Match the system language');
  map.set('始终使用中文界面', 'Always use Chinese');
  map.set('始终使用英文界面', 'Always use English');
  return map;
}

const EN: Map<string, string> = buildEnglish();
