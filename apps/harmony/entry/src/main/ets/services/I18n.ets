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
  // —— 语音输入 ——
  map.set('正在听…', 'Listening…');
  map.set('松开发送 · 上滑取消', 'Release to send · swipe up to cancel');
  map.set('松开取消', 'Release to cancel');
  map.set('主机未启用语音转写（缺 speech-to-text 插件），先用键盘输入',
    'Voice transcription is not enabled on the host (speech-to-text plugin missing)');
  map.set('正在转写…', 'Transcribing…');
  map.set('没有麦克风权限，去系统设置里允许后再试',
    'No microphone permission — allow it in Settings and try again');
  map.set('录音启动失败：', 'Could not start recording: ');
  map.set('太短了，没听清', 'Too short — nothing captured');
  map.set('没识别出内容', 'No speech recognised');
  map.set('语音转写失败：', 'Transcription failed: ');
  // —— 连接过程 ——
  map.set('正在初始化…', 'Starting up…');
  map.set('正在建立安全连接…', 'Establishing secure connection…');
  map.set('NOISE IK 握手 · 能力协商需要几秒', 'Noise IK handshake · negotiating capabilities takes a few seconds');
  // —— 会话面板 ——
  map.set('搜索会话…', 'Search sessions…');
  map.set('会话名称', 'Session name');
  map.set('新会话', 'New session');
  map.set('今天', 'Today');
  map.set('昨天', 'Yesterday');
  map.set('更早', 'Earlier');
  map.set('会话列表加载失败', 'Could not load sessions');
  map.set('正在重新加载…', 'Reloading…');
  map.set('正在加载会话…', 'Loading sessions…');
  map.set('发送第一条消息开始对话', 'Send the first message to start');
  map.set('工作区名称', 'Workspace name');
  map.set('浏览文件', 'Browse files');
  map.set('重命名', 'Rename');
  map.set('删除工作区', 'Delete workspace');
  // —— 聊天页 ——
  map.set('正在生成…', 'Generating…');
  map.set('会话信息', 'Session info');
  map.set('模型', 'Model');
  map.set('上下文', 'context');
  map.set('未选择', 'none');
  map.set('切换模型', 'Switch model');
  map.set('权限', 'Perm');
  map.set('只读', 'Read');
  map.set('可写', 'Write');
  map.set('完全', 'Full');
  map.set('权限：只读', 'Permission: read-only');
  map.set('权限：工作区可写', 'Permission: workspace write');
  map.set('权限：完全权限', 'Permission: full access');
  map.set(' 步 · ', ' steps · ');
  map.set('收起', 'collapse');
  map.set('展开', 'expand');
  map.set('回到最新', 'Jump to latest');
  map.set('发送消息…', 'Send a message…');
  map.set('正在生成，可插话…', 'Generating — you can steer…');
  map.set('插话发送（长按发送键切换）', 'Steer (long-press send to switch)');
  map.set('发送方式', 'Send mode');
  map.set('当前：插话（立刻打断当前轮）', 'Now: steer (interrupts this turn)');
  map.set('当前：排队（本轮结束后再发）', 'Now: queued (sent after this turn)');
  map.set('排队发送', 'Queue');
  map.set('插话打断', 'Steer');
  map.set('允许', 'Allow');
  map.set('拒绝', 'Reject');
  map.set('可多选', 'multi-select');
  map.set('提交回答', 'Submit answer');
  map.set('已允许', 'allowed');
  map.set('已拒绝', 'rejected');
  map.set('已取消', 'cancelled');
  map.set('已失效', 'expired');
  map.set('已回答', 'answered');
  map.set('已提交', 'submitted');
  map.set('消息操作', 'Message actions');
  map.set('复制文本', 'Copy text');
  map.set('已复制', 'Copied');
  map.set('复制失败', 'Copy failed');
  map.set('从这里分叉', 'Fork from here');
  map.set('你发送的消息', 'Your message');
  map.set('助手回复', 'Assistant reply');
  map.set('图片加载中…', 'Loading image…');
  map.set('图片加载失败', 'Image failed to load');
  map.set('无法打开链接', 'Could not open link');
  // —— 登录 / 设备页补漏 ——
  map.set('未配置服务器', 'No server configured');
  map.set('授权链接已复制', 'Authorization link copied');
  map.set('复制失败，可长按链接手动复制', 'Copy failed — long-press the link to copy it');
  map.set('重置设备身份', 'Reset device identity');
  map.set('重置', 'Reset');
  // —— 失败提示（上下文超窗等）——
  map.set('上下文已超出模型窗口，这一轮没有执行',
    'The context exceeded the model window, so this turn did not run');
  map.set('先压缩上下文（/compact）再重新发送，或新开一个会话',
    'Compact the context (/compact) and send again, or start a new session');
  map.set('压缩上下文', 'Compact context');
  map.set('本轮输出达到模型上限，内容被截断', 'This turn hit the output ceiling and was truncated');
  map.set('输出达到上限，可以让我继续或拆小一点',
    'Output was capped — ask me to continue, or split the task');
  map.set('本轮失败', 'Turn failed');
  map.set('未知原因', 'unknown reason');
  map.set('主机没有给出失败原因', 'the host gave no failure reason');
  map.set('图片读取失败：', 'Could not read the image: ');
  // —— 顶栏齿轮面板 ——
  map.set('会话设置', 'Session settings');
  map.set('更换', 'Change');
  map.set('推理等级', 'Reasoning');
  map.set('正在读取模型目录…', 'Loading model catalog…');
  map.set('连接', 'Connected to');
  map.set('断开连接', 'Disconnect');
  map.set('新会话', 'New session');
  return map;
}

const EN: Map<string, string> = buildEnglish();
