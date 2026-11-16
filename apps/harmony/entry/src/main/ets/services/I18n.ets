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
  map.set('服务器地址（http://…）', 'Server URL (http://…)');
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
  map.set('DSH主机列表', 'DSH hosts');
  map.set('选一台主机，继续上次的工作', 'Pick a host and pick up where you left off');
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
  map.set('服务器', 'Server');
  map.set('切换账号', 'Switch account');
  map.set('已保存的登录（一键进入）', 'Saved sign-ins (one tap)');
  map.set('进入', 'Enter');
  map.set('切换服务器', 'Switch server');
  map.set('更多', 'More');
  map.set('常用', 'Presets');
  map.set('本地', 'Local');
  map.set('官方服务器', 'Official server');
  map.set('本地服务器', 'Local server');
  map.set('自定义服务器', 'Custom server');
  map.set('点一下即切换，不用重输密码', 'Tap to switch — no password needed');
  map.set('登录其他服务器…', 'Sign in to another server…');
  map.set('已保存的登录态，点一下就切（无需重新输密码）',
    'Saved sign-ins — tap one to switch, no password needed');
  map.set('切换', 'Switch');
  map.set('当前', 'Current');
  map.set('更换', 'Change');
  map.set('推理等级', 'Reasoning');
  map.set('正在读取模型目录…', 'Loading model catalog…');
  map.set('连接状态', 'Connection');
  map.set('断开连接', 'Disconnect');
  map.set('新会话', 'New session');

  // —— 诊断导出（0.17.97）——
  map.set('存文件', 'Save to file');
  map.set('导出失败（存储不可用）', 'Export failed (storage unavailable)');
  map.set('已保存，可用 hdc file recv 拉走', 'Saved — pull it with hdc file recv');
  map.set('诊断已导出，可 hdc file recv 拉走', 'Diagnostics exported — pull it with hdc file recv');

  // —— A 组 / 稳定性 / 诊断 新增文案（0.17.81–0.17.88）——
  map.set(' 个', '');
  map.set(' 字', ' chars');
  map.set(' 行', ' lines');
  map.set(' 轮', ' turns');
  map.set('上次 ', 'Last ');
  map.set('下次 ', 'Next ');
  map.set('会话', 'Sessions');
  map.set('停止', 'Stop');
  map.set('全部', 'All');
  map.set('关', 'Off');
  map.set('分享', 'Share');
  map.set('分叉', 'Fork');
  map.set('创建', 'Create');
  map.set('删除', 'Delete');
  map.set('刷新', 'Refresh');
  map.set('历史', 'History');
  map.set('发送', 'Send');
  map.set('复制', 'Copy');
  map.set('大', 'Large');
  map.set('失败', 'Failed');
  map.set('官方', 'Official');
  map.set('导出', 'Export');
  map.set('小', 'Small');
  map.set('工具', 'Tools');
  map.set('布局', 'Layout');
  map.set('平台', 'Platform');
  map.set('开', 'On');
  map.set('引用', 'Quote');
  map.set('归档', 'Archive');
  map.set('收藏', 'Favorite');
  map.set('新建', 'New');
  map.set('显示', 'Shown');
  map.set('暖沙', 'Sand');
  map.set('最近', 'Recent');
  map.set('有 ', 'Has ');
  map.set('标准', 'Standard');
  map.set('桌宠', 'Desk pet');
  map.set('森林', 'Forest');
  map.set('深海', 'Deep sea');
  map.set('添加', 'Add');
  map.set('清空', 'Clear');
  map.set('特大', 'Extra large');
  map.set('玫紫', 'Rose');
  map.set('管理', 'Manage');
  map.set('紧凑', 'Compact');
  map.set('置顶', 'Pin');
  map.set('自动', 'Auto');
  map.set('草稿', 'Drafts');
  map.set('诊断', 'Diagnostics');
  map.set('账号', 'Account');
  map.set('选择', 'Choose');
  map.set('通用', 'General');
  map.set('隐藏', 'Hidden');
  map.set('默认', 'Default');
  map.set(' 个任务', ' tasks');
  map.set(' 张图待发', ' image(s) queued');
  map.set(' 张图片过大已跳过（单张上限约 3.5MB）', ' image(s) skipped: too large (max ~3.5 MB each)');
  map.set('Host 侧的 Remote 插件没有导出 schedule/* 端点，升级插件后这里会自动出现列表。', 'The Host Remote plugin does not expose schedule/* yet; upgrade the plugin and the list appears here.');
  map.set('PDF 打开失败：', 'Failed to open PDF: ');
  map.set('· DeepSeek 账号请用上面的扫码/授权', '· For a DeepSeek account, use the QR/authorization above');
  map.set('主机上的目录（绝对路径）', 'Directory on the host (absolute path)');
  map.set('主机操作', 'Host actions');
  map.set('主机版本', 'Host version');
  map.set('主题色', 'Accent theme');
  map.set('会删除本机的草稿、提示词、收藏与最近访问，登录态和主机凭据不动。确定吗？', 'This deletes local drafts, prompts, favorites and recents. Sign-in and host credentials are kept. Continue?');
  map.set('会话 Markdown 已复制', 'Session Markdown copied');
  map.set('会话栏宽度', 'Session column width');
  map.set('会话详情', 'Session details');
  map.set('停止重连', 'Stop reconnecting');
  map.set('先填一个主机上的绝对路径', 'Enter an absolute path on the host first');
  map.set('全屏编辑', 'Full-screen editor');
  map.set('公钥指纹', 'Key fingerprint');
  map.set('关 · 传完整历史', 'Off · send full history');
  map.set('关 · 原文显示', 'Off · show plain text');
  map.set('写作辅助', 'Writing help');
  map.set('分享内容已复制', 'Share text copied');
  map.set('分栏时自动收紧，单列保持宽松', 'Tighter in split view, roomier in a single column');
  map.set('列表密度', 'List density');
  map.set('加载中…', 'Loading…');
  map.set('加载更早的消息', 'Load earlier messages');
  map.set('发送消息…（Enter 换行 · Ctrl+Enter 发送）', 'Send a message… (Enter for newline · Ctrl+Enter to send)');
  map.set('取消归档', 'Unarchive');
  map.set('取消收藏', 'Remove favorite');
  map.set('取消置顶', 'Unpin');
  map.set('只留标题和时间，隐藏轮数与目录', 'Titles and times only; hide turns and cwd');
  map.set('右侧详情栏', 'Right details pane');
  map.set('在电脑上安装 DSH 并用同一账号登录，主机就会出现在这里', 'Install DSH on a computer and sign in with the same account; the host appears here');
  map.set('在这里写长消息，换行不会丢（Ctrl+Enter 发送）', 'Write long messages here; newlines are preserved (Ctrl+Enter to send)');
  map.set('填入当前浏览目录', 'Use the directory being browsed');
  map.set('填入示例：每天 9 点跑一次巡检，结果发到这个会话', 'Insert example: run a check daily at 9 and post results to this session');
  map.set('复制为 Markdown', 'Copy as Markdown');
  map.set('复制代码块', 'Copy code block');
  map.set('复制全部', 'Copy all');
  map.set('复制标题', 'Copy title');
  map.set('完成通知', 'Completion notifications');
  map.set('定时任务', 'Scheduled tasks');
  map.set('客户端版本', 'Client version');
  map.set('导出失败', 'Export failed');
  map.set('展开全文', 'Show full text');
  map.set('工作区', 'Workspace');
  map.set('已停用', 'Disabled');
  map.set('已关闭：下次打开会话生效', 'Disabled — applies next time you open a session');
  map.set('已填入输入框，发送即可让 agent 创建', 'Inserted into the composer; send it and the agent creates it');
  map.set('已复制主机信息', 'Host info copied');
  map.set('已复制代码', 'Code copied');
  map.set('已复制标题', 'Title copied');
  map.set('已复制该条命令', 'Command copied');
  map.set('已复制该行', 'Line copied');
  map.set('已开启：下次打开会话生效', 'Enabled — applies next time you open a session');
  map.set('已引用到输入框', 'Quoted into the composer');
  map.set('已归档', 'Archived');
  map.set('已归档 ', 'Archived ');
  map.set('已恢复默认宽度', 'Default width restored');
  map.set('已清空本地数据', 'Local data cleared');
  map.set('已粘贴图片', 'Image pasted');
  map.set('已遮挡敏感内容 · 点此看原文', 'Sensitive text masked · tap to reveal');
  map.set('开 · 历史工具输出转摘要', 'On · history tool output summarized');
  map.set('开 · 干活/等确认/完成 四态', 'On · four states: working / waiting / done / idle');
  map.set('开 · 点气泡看原文', 'On · tap a bubble to reveal');
  map.set('引用到输入框', 'Quote into composer');
  map.set('归档会话', 'Archive session');
  map.set('快捷入口', 'Shortcuts');
  map.set('执行轨迹', 'Execution trace');
  map.set('挑一条常用提示词填进输入框', 'Pick a saved prompt to fill the composer');
  map.set('换一套氛围色（背景/面板/表面），强调色保持不变', 'Pick a mood palette (background / panel / surface); the accent color stays');
  map.set('提示词', 'Prompts');
  map.set('提示词库', 'Prompt library');
  map.set('提示词库可一键填入常用说法；长文用全屏编辑', 'The library fills common phrases in one tap; use full-screen editing for long text');
  map.set('插话发送…', 'Steer…');
  map.set('搜索本会话', 'Search this session');
  map.set('收起巡检原文', 'Hide raw heartbeat text');
  map.set('收起归档', 'Hide archived');
  map.set('敏感内容打码', 'Mask sensitive text');
  map.set('整屏写长文，换行不会丢', 'Write on the full screen; newlines are preserved');
  map.set('文字大小', 'Text size');
  map.set('新增一条提示词…', 'Add a prompt…');
  map.set('新建工作区', 'New workspace');
  map.set('新建要在会话里说一句，由主机上的 agent 用 schedule_create 工具创建（协议不开放客户端直接创建）。', 'To create one, ask inside the session: the host agent uses the schedule_create tool (the protocol does not allow client-side creation).');
  map.set('显示名称（可留空）', 'Display name (optional)');
  map.set('更换模型', 'Change model');
  map.set('最后在线', 'Last seen');
  map.set('最近事件', 'Recent events');
  map.set('最近事件：', 'Recent events:');
  map.set('未连接', 'Not connected');
  map.set('本次会话还没有工具调用', 'No tool calls in this session yet');
  map.set('本轮结束后再发，不打断', 'Send after this turn; no interruption');
  map.set('查看巡检原文', 'Show raw heartbeat text');
  map.set('查看详情', 'View details');
  map.set('正在切换服务器…', 'Switching server…');
  map.set('正在生成：插话会立刻打断当前这一轮', 'Generating: steering interrupts the current turn immediately');
  map.set('正在重连，连上后再发', 'Reconnecting — send once connected');
  map.set('每天 9 点跑一次巡检，结果发到这个会话', 'Run a check daily at 9 and post results to this session');
  map.set('没有匹配的会话', 'No matching sessions');
  map.set('没有匹配的消息', 'No matching messages');
  map.set('测延迟', 'Measure latency');
  map.set('测量中…', 'Measuring…');
  map.set('清空本地数据', 'Clear local data');
  map.set('清除公钥固定', 'Clear pinned key');
  map.set('点右上角「新建」开一个', 'Tap New in the top right to start one');
  map.set('用账号密码登录', 'Sign in with email and password');
  map.set('留空则用目录名', 'Leave empty to use the directory name');
  map.set('空闲时两种方式没有区别', 'When idle both modes behave the same');
  map.set('立刻发出去，打断当前这一轮', 'Send now and interrupt the current turn');
  map.set('立即重试', 'Retry now');
  map.set('等你确认', 'Waiting for your confirmation');
  map.set('精简历史', 'Compact history');
  map.set('系统通知权限未开启', 'System notification permission is off');
  map.set('编辑消息', 'Edit message');
  map.set('网络已断开，恢复后自动重连', 'Network lost — reconnecting automatically once it returns');
  map.set('自动（分栏时紧凑）', 'Auto (compact in split view)');
  map.set('草稿/提示词/收藏', 'Drafts / prompts / favorites');
  map.set('行高小一点，同屏多两行', 'Tighter lines; two more per screen');
  map.set('设备 ID', 'Device ID');
  map.set('诊断信息已复制', 'Diagnostics copied');
  map.set('读取中…', 'Reading…');
  map.set('超紧凑', 'Ultra compact');
  map.set('输入 / 查看主机命令，点 ✦ 打开提示词库', 'Type / for host commands, tap ✦ for the prompt library');
  map.set('输入关键词…', 'Type keywords…');
  map.set('运行中', 'Running');
  map.set('还没有', 'Nothing yet');
  map.set('还没有会话', 'No sessions yet');
  map.set('还没有可用的主机', 'No hosts available yet');
  map.set('还没有定时任务', 'No scheduled tasks yet');
  map.set('还没有提示词，下面加一条', 'No prompts yet — add one below');
  map.set('还没有记录', 'No records yet');
  map.set('这台主机没有开启定时任务', 'This host has no scheduled tasks enabled');
  map.set('这张会话还没有内容', 'This session has no content yet');
  map.set('这轮做完了', 'Turn finished');
  map.set('连接中断，正在重连…', 'Connection lost — reconnecting…');
  map.set('连接诊断', 'Connection diagnostics');
  map.set('连接详情', 'Connection details');
  map.set('链路日志（已落盘，重启 App 也保留）', 'Link log (persisted; survives app restart)');
  map.set('鲸娘在干活', 'Mochi is working');
  map.set('鲸娘在待命（设置里可关掉）', 'Mochi is idle (can be turned off in settings)');

  return map;
}

const EN: Map<string, string> = buildEnglish();
