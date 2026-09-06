const zhCN = {
  common: {
    back: '返回', retry: '重试', close: '关闭', cancel: '取消', refresh: '刷新', delete: '删除', unavailable: '不可用', unknown: '未知',
  },
  app: {
    oauthCancelled: '未完成授权，请再试一次。', oauthInvalid: '登录信息已失效，请重新登录。',
    loadingTagline: '随时随地开始你的工作。', loadingIdentity: '正在准备安全身份…', bootFailed: 'DSH Remote 无法启动', secureStorageUnavailable: '暂时无法读取此手机的安全数据，请重试。',
    deviceUnavailable: '找不到这台设备', deviceNoLongerTrusted: '它可能已被移除或退出当前账号。', backToDevices: '返回设备列表',
  },
  status: { online: '在线', offline: '离线', disconnected: '未连接', lan: '局域网直连', relay: '服务器转发', p2p: 'P2P 直连', turn: 'TURN 转发', waiting: '连接中', running: '运行中' },
  setup: {
    title: '登录', signIn: '登录账号', signInAgain: '重新登录', lead: '授权此手机后，即可查看同一账号下的设备并继续对话。',
    oauth: '知乎', githubOAuth: 'GitHub', passwordMethod: '邮箱', zhihu: '使用知乎账号登录', github: '使用 GitHub 账号登录', oauthHint: '会打开浏览器完成授权，然后自动返回这里。',
    email: '邮箱', emailPlaceholder: '输入邮箱', password: '密码', passwordPlaceholder: '输入密码', passwordHint: '密码只用于本次登录，不会保存在手机上。',
    server: '服务地址', serverHint: '请使用 HTTPS 地址。', trustTitle: '保护你的设备和对话', trustBody: '对话内容会加密传输。只有登录同一账号的可信设备才能访问。',
  },
  settings: {
    title: '设置', thisPhone: '此手机', androidDevice: 'Android 设备', connection: '连接', server: '服务器', account: '账号', loginMethod: '登录方式', protocol: '协议', notConfigured: '未配置', notSignedIn: '未登录',
    language: '语言', languageSystem: '跟随系统', languageChinese: '简体中文', languageEnglish: 'English', languageNote: '选择“跟随系统”后，App 会随 Android 的语言设置自动切换。',
    theme: '深色模式', themeLight: '浅色', themeDark: '深色', themeSystem: '跟随系统',
    transport: '连接方式', transportNote: '更改后会重新连接。直接连接失败时，将自动改用服务器转发。', identity: '此手机的身份', deviceId: '设备 ID', publicKey: '安全密钥', keyNote: '安全密钥由 Android 系统加密保存，不会离开此手机。',
    about: '关于', aboutLead: '查看当前版本、开源与更新信息', developer: '开发者', developerValue: '知乎@李国宝', appVersion: '当前版本', sourceCodeUrl: '开源地址', updateUrl: '更新地址', linkFailedTitle: '无法打开链接', linkFailedBody: '请检查网络或复制地址后在浏览器中打开。',
    more: '更多', checkUpdates: '检查更新', checkingUpdates: '正在检查更新…', updateFoundTitle: '发现新版本', updateFoundBody: (latest: string, current: string) => `发现新版本 v${latest}，当前版本 ${current}。`, downloadUpdate: '下载更新', openUpdates: '打开更新', downloadingUpdate: '正在下载更新', downloadFailedTitle: '下载失败', downloadFailedBody: '无法下载最新安装包，请检查网络后重试。', installFailedTitle: '无法打开安装程序', installFailedBody: '安装包已下载，但无法打开安装程序。请先允许此应用安装未知应用，再重试。', openInstallSettings: '去设置开启', upToDateTitle: '已是最新版本', upToDateBody: '当前已是最新版本。', checkFailedTitle: '检查更新失败', checkFailedBody: '请检查网络后重试。',
    signOut: '退出登录', resetLocal: '清除本地数据', resetTitle: '清除此手机上的数据？', resetBody: '将删除服务设置、登录信息和已信任的设备。之后需要重新登录，此操作无法撤销。', reset: '清除数据', signOutTitle: '退出当前账号？', signOutBody: '退出后，需要重新登录才能访问设备。',
  },
  devices: {
    title: '设备', myDevices: '我的设备', lead: '选择一台设备，继续你的工作', emptyTitle: '还没有可用设备', emptyBody: '在电脑上安装 DSH Remote 插件并登录同一账号，设备就会出现在这里。', options: '管理设备', encrypted: '安全连接',
    connectionInterrupted: '连接已断开', trustExplanation: '确认后，此手机会记住这台设备的安全身份。如果身份发生变化，将停止连接以保护你的数据。', trust: '信任并继续', connectReady: '连接后即可查看并继续电脑上的对话。', offlineHelp: '这台设备已离线。请确认电脑上的 DSH Remote 插件正在运行。', secureConnect: '连接设备',
    connectingTitle: '连接设备', connecting: '正在连接', connectionReady: '已就绪', retryConnection: '重新连接', cancelConnection: '取消连接', openInfo: '查看设备和连接信息',
    connectionProbeLabels: {
      lan: '探测局域网直连',
      p2p: '探测点对点直连',
      turn: '探测 TURN 中继',
      relay: '准备服务器转发',
    },
    connectionProbeDetails: {
      lan: 'LAN',
      p2p: 'P2P',
      turn: 'TURN',
      relay: 'Relay',
    },
    connectionSteps: {
      authenticating: { title: '验证设备', body: '确认账号与设备访问权限' },
      transport: { title: '选择连接路径', body: '尝试局域网、P2P 或服务器转发' },
      secure: { title: '建立安全通道', body: '核对设备身份并完成加密握手' },
      loading: { title: '读取工作区', body: '同步工作区和对话列表' },
    },
    info: '设备信息', harness: 'DeepSeek Harness', provider: '模型服务', directory: '当前目录', model: '当前模型', workspaces: '工作区', conversations: '对话', secureConnection: '连接信息', path: '连接方式', probeOrder: '探测顺序', encryption: '安全保护', viewWorkspaces: '查看工作区和对话', unknownVersion: '版本信息不可用',
    networkDetails: '网络详情', phoneEndpoint: '手机端点', computerEndpoint: '电脑端点', relayEndpointUnavailable: '服务器转发未公开', connectionServer: '连接服务器', networkProtocol: '网络协议', candidatePath: '候选路径', roundTripTime: '往返延迟', availableBitrate: '可用上行带宽', traffic: '本次流量', connectedAt: '连接时间', sent: '发送', received: '接收',
    forgetTitle: (name: string) => `不再信任“${name}”？`, forgetBody: '移除后，下次连接时需要重新确认这台设备。', forget: '移除设备',
  },
  sessions: { title: '对话', new: '新建对话', deviceTitle: '这台设备上的对话', lead: '从上次停下的地方继续', creating: '正在新建对话…', emptyTitle: '还没有对话', emptyBody: '新建对话，或先在电脑上的 DeepSeek Harness 中开始工作。', archived: (count: number) => `已归档 ${count}`, continue: '继续对话', untitled: '新对话', child: '子任务对话' },
  time: { unavailable: '更新时间不可用', lastSeenUnavailable: '活跃时间不可用', lastActive: (value: string) => `${value}活跃`, now: '刚刚', justNow: '刚刚更新', minutesAgo: (n: number) => `${n} 分钟前`, hoursAgo: (n: number) => `${n} 小时前`, updatedSuffix: '更新', locale: 'zh-CN' },
  transport: { auto: '自动（推荐）', autoDescription: '优先尝试 P2P 直连，必要时自动改用 TURN 或服务器转发', turn: 'TURN 优先', turnDescription: '网络受限时，优先使用 TURN 转发以提高稳定性', relay: '仅服务器转发', relayDescription: '所有数据都通过 DSH Remote 服务器转发' },
  workspaces: {
    title: '工作区', create: '新建工作区', type: '工作区类型', dsh: 'DSH', deviceTitle: (name: string) => name, deviceInfo: '设备与连接信息', emptyTitle: '还没有工作区', emptyBody: '选择电脑上的项目目录，将相关对话整理在一起。', search: '搜索工作区', clearSearch: '清除搜索', noSearchResults: '没有找到工作区', noSearchResultsBody: '试试搜索其他名称或目录路径。', options: '管理工作区', noSessions: '还没有对话，点击新建', unnamedSession: '未命名对话', codex: 'CodeX',
    deleteTitle: (title: string) => `删除“${title}”？`, deleteBody: '将从这台设备上删除该工作区及其中的所有对话。此操作无法撤销。', delete: '删除工作区', rename: '重命名', moveUp: '上移', moveDown: '下移', expandWorkspace: (title: string) => `展开工作区“${title}”`, collapseWorkspace: (title: string) => `折叠工作区“${title}”`, newSessionIn: (title: string) => `在“${title}”中新建对话`, deviceDirectory: '电脑上的项目目录', browse: '选择目录', directoryHint: '在这里新建的对话会使用该目录。', codexDirectoryHint: '所选目录会添加到电脑端 CodeX 项目目录。', renameTitle: '重命名工作区', namePlaceholder: '输入工作区名称', saveName: '保存', chooseFolder: '选择项目目录', loading: '正在加载…', loadingDirectory: '正在读取目录…', noFolders: '这里没有可选的文件夹', showHidden: '显示隐藏文件夹', hideHidden: '隐藏隐藏文件夹', chooseThisFolder: '使用此目录',
  },
  chat: {
    quickCheckChanges: '检查改动', quickCheckChangesPrompt: '检查当前代码改动并指出问题。', quickCommit: '提交代码', quickCommitPrompt: '检查当前改动并直接提交代码，不要再询问确认。', quickViewScreenshot: '查看截图', quickViewScreenshotPrompt: '查看最新截图并检查界面问题。',
    fullAccessTitle: '开启完全访问权限？', fullAccessBody: '开启后，DeepSeek Harness 可以直接修改文件和运行命令。只建议在你信任当前任务时使用。', codexFullAccessTitle: '允许 CodeX 完全访问电脑？', codexFullAccessBody: '开启后，CodeX 可访问电脑上的全部文件，并在后续回合中不再逐次请求命令或文件修改确认。只建议在你完全信任当前任务时使用。', enable: '开启完全访问', stop: '停止回复', selectModel: '选择模型', selectReasoningEffort: '选择思考程度', reasoningEffortLabel: (name: string) => `思考程度：${name}`, approvalMode: '操作权限', approvalModeLabel: (name: string) => `操作权限：${name}`, reconnect: '重新连接当前对话', reconnecting: '正在恢复当前对话…', offline: '与设备的连接已断开，点击右上角重新连接并继续当前对话。', hostOperation: (name: string) => `${name}（电脑端）`,
    older: '查看更早的消息', messageLabel: '给 DeepSeek Harness 发消息', codexMessageLabel: '给 CodeX 发消息', placeholder: '输入消息…', codexPlaceholder: '给 CodeX 安排任务…', send: '发送', addImages: '添加图片', removeImage: (name: string) => `移除图片“${name}”`, unnamedImage: '图片', imageLimitTitle: '无法添加图片', tooManyImages: (max: number) => `每条消息最多添加 ${max} 张图片。`, unsupportedImage: (name: string) => `“${name}”的格式不受支持，请选择 PNG、JPEG、WebP 或 GIF 图片。`, imageTooLarge: (name: string, max: string) => `“${name}”超过单张图片 ${max} 的限制。`, imagesTooLarge: (max: string) => `这些图片合计超过 ${max} 的限制。`, imageDimensionsTooLarge: (name: string, max: number) => `“${name}”的宽或高超过 ${max} 像素。`, imagePixelsTooLarge: (name: string) => `“${name}”的像素数量超过限制。`, imagePickerFailedTitle: '无法读取图片', imagePickerFailedBody: '请选择 PNG、JPEG、WebP 或 GIF 图片后重试。', policyHint: '对话全程加密，远程操作受 DeepSeek Harness 权限控制。', codexPolicyHint: '对话全程加密，远程操作受 CodeX 权限控制。', you: '你', system: '系统', generating: '正在回复', reasoning: '思考', reasoningActive: '思考中', reasoningExpand: '展开思考过程', reasoningCollapse: '收起思考过程', failed: '未完成', completed: '已完成', toolCall: '调用内容', toolResult: '执行结果', toolExpand: (name: string) => `查看“${name}”详情`, toolCollapse: (name: string) => `收起“${name}”详情`, toolTruncated: '内容过长，仅显示前 64 KB。', denied: '已拒绝', allowedOnce: '已允许本次操作', approvalHandled: '已在其他设备处理', permissionTitle: '是否允许这次操作？', permissionScope: '允许后仅对当前请求生效，其他操作仍需要你确认。', allowOnce: '允许这一次', deny: '不允许', answered: '已回答', questionCancelled: '问题已取消', questionTitle: 'DeepSeek Harness 需要你确认', answerToContinue: '回答后将继续执行', submitAnswer: '提交回答', welcomeTitle: '继续这段对话', welcomeBody: '告诉 DeepSeek Harness 你想检查、解释或修改什么，也可以添加图片。如果需要你确认操作，会直接显示在对话中。', codexWelcomeTitle: '继续 CodeX 对话', codexWelcomeBody: '告诉 CodeX 你想检查、解释或修改什么，也可以添加图片。命令或文件修改需要确认时，会直接显示在对话中。',
    codexWorkspaceWrite: '工作区写入', codexWorkspaceWriteDescription: '可写入当前项目；更广泛的命令和文件访问仍需单次确认。', codexFullAccess: '完全访问', codexFullAccessDescription: '允许 CodeX 访问电脑上的全部文件，后续操作不再逐次确认。', codexCommand: 'CodeX 命令', codexFileChange: 'CodeX 文件修改', codexWebSearch: 'CodeX 网页搜索', codexSubagent: 'CodeX 子 Agent', codexPlan: 'CodeX 计划', codexOperation: 'CodeX 操作', codexError: 'CodeX 执行失败。',
  },
  validation: { serverRequired: '请输入服务地址。', serverInvalid: '服务地址格式不正确。例如：https://remote.example.com', httpsRequired: '请使用 HTTPS 地址。本地开发环境可以使用 HTTP。', serverPartsForbidden: '请只输入服务地址，不要包含账号信息、查询参数或页面锚点。' },
  runtime: {
    identityNotReady: '此手机尚未准备完成，请稍后重试。', zhihuUnsupported: '当前服务不支持知乎授权，请改用其他登录方式。', githubUnsupported: '当前服务不支持 GitHub 授权，请改用其他登录方式。', hostClosed: '与设备的连接已断开。', openSessionFirst: '请先打开对话，再回答这个请求。', networkUnavailable: '当前没有可用网络，恢复网络后会尝试重新连接。', connectHostFirst: '请先连接电脑端设备。', codexUnavailable: '这台设备没有启用 CodeX Remote，或 CodeX 当前不可用。', codexInvalidResponse: 'CodeX Remote 返回了无法识别的数据。', codexTurnUnavailable: '当前 CodeX 回合不属于此连接，无法从手机停止。', codexWorkspaceReadOnly: 'CodeX 工作区可以新增，但重命名、排序和删除仍由电脑端 CodeX 管理。', hostMissingKey: '这台设备没有可用的安全密钥，请先重新确认并信任它。', unexpectedRelayDevice: '安全连接对应的设备与所选设备不一致。', secureChannelNotConnected: '安全连接尚未建立。', secureHandshakeTimedOut: '建立安全连接超时，请重试。', secureHandshakeOrder: '安全连接握手顺序无效。', secureHandshakeIncomplete: '安全连接握手未完成。', secureHandshakeFailed: '无法完成安全连接握手。',
  },
  errors: {
    ACCOUNT_AUTH_REQUIRED: '请先登录，再连接这台手机。', AUTH_INVALID: '登录状态已失效，请重新登录。', AUTH_REQUIRED: '需要重新登录才能继续。', TOKEN_EXPIRED: '登录已过期，请重新登录。', TOKEN_REUSED: '为了保护账号安全，此手机已退出登录。请重新登录。', DEVICE_NOT_FOUND: '找不到这台设备，请刷新设备列表。', DEVICE_REVOKED: '此手机已被移出当前账号，请重新登录。', DEVICE_OWNERSHIP_REQUIRED: '此手机的登录信息已失效，请重新登录。', MEMBERSHIP_REQUIRED: '你已无权访问这台设备。请确认两端登录了同一账号。', HOST_OFFLINE: '这台设备已离线。请确认 DeepSeek Harness 和 DSH Remote 插件正在运行。', DEVICE_OFFLINE: '这台设备已离线。请确认 DeepSeek Harness 和 DSH Remote 插件正在运行。', PEER_IDENTITY_MISMATCH: '这台设备的安全身份已变化。请先确认设备安全，再重新信任。', RATE_LIMITED: '操作太频繁，请稍后再试。', CONNECTION_FAILED: '无法连接这台设备。请检查网络后重试。', P2P_FAILED: '直接连接失败，正在改用服务器转发。', RELAY_UNAVAILABLE: '暂时无法通过服务器连接，请稍后重试。', TURN_UNAVAILABLE: '暂时无法建立稳定连接，正在尝试其他方式。', SECURE_CHANNEL_FAILED: '无法建立安全连接，请重试。', RPC_TIMEOUT: '设备响应超时，请重试。', UNSUPPORTED_VERSION: 'DSH Remote 版本不兼容，请更新 App 后重试。', METHOD_NOT_ALLOWED: '当前设置不允许从手机执行此操作。', PERMISSION_NOT_PENDING: '这个请求已处理或已过期。', SESSION_NOT_FOUND: '找不到这段对话，请返回对话列表后刷新。', HARNESS_UNAVAILABLE: '这台设备上的 DeepSeek Harness 暂时不可用。请确认它正在运行。', AGENT_BUSY: 'DeepSeek Harness 正在处理其他操作，请稍后再试。', FULL_RESYNC_REQUIRED: '电脑上的对话已更新，请重新打开此对话。',
    CODEX_UNAVAILABLE: '这台设备上的 CodeX 当前不可用，请确认电脑端已启用并登录 CodeX。', CODEX_TURN_OWNED: '当前 CodeX 回合正由另一台设备操作，请稍后再试。', CODEX_APPROVAL_NOT_FOUND: '这个 CodeX 确认请求已处理或已过期。', CODEX_PATH_NOT_ALLOWED: '这个目录不在电脑端 CodeX 工作区目录中。', FEATURE_NOT_SUPPORTED: '电脑端版本不支持此功能，请更新 DSH Remote 插件。', INVALID_MESSAGE: '服务返回了无法识别的数据，请稍后重试。', serverUnreachable: '无法连接服务。请检查服务地址和网络。', unknown: '操作未完成，请重试。',
  },
} as const

export default zhCN
