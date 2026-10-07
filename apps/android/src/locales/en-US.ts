import type { Messages } from './types'

const enUS = {
  tools: {
    "files": "Files",
    "terminal": "Terminal",
    "root": "Workspace",
    "empty": "This folder is empty",
    "truncated": "The Host returned a partial listing because this directory has too many entries.",
    "previous": "Previous page",
    "next": "Next page",
    "readOnly": "Read-only preview",
    "retry": "Retry",
    "refresh": "Refresh",
    "unsupported": "Update DSH and the Remote plugin on this Host, then reconnect to use this feature.",
    "terminalDisabled": "Enable Remote terminal in the computer’s Remote settings, then retry.",
    "controlDenied": "Another connection controls this terminal. Reopen it to attach again.",
    "notText": "This file is not UTF-8 text and cannot be previewed.",
    "tooLarge": "The file or page exceeds the Host read limit.",
    previewUnsupported: 'Preview is not available for this file type. Unknown binary files are not opened as text.',
    previewTooLarge: 'Mobile limits: 8 MiB, image dimensions of 8192 pixels and 16 million pixels total; Office sources: 50 MiB.',
    accessDenied: 'The Host denied access for this session. Check authorization on the computer.',
    previewChanged: 'The file changed while being read. Refresh and try again.',
    previewInvalid: 'The Host returned invalid file data. Preview was stopped.',
    previewFailed: 'This file could not be displayed. Try again.',
    previewLoading: 'Reading file…',
    officeLoading: 'Converting to PDF on the computer…',
    officeUnavailable: 'Document conversion is unavailable. Check that Office to PDF support is installed and enabled on the computer.',
    officeFailed: 'Document conversion failed. The document may be unsupported or damaged.',
    officeBusy: 'Document conversion is busy or timed out. Try again later.',
    missingFonts: (fonts: string) => `Missing fonts on the computer; layout may differ: ${fonts}`,
    pdfPage: (page: number, total: number) => `Page ${page} of ${total}`,
    pdfLoading: 'Rendering PDF…',
    pdfPassword: 'Encrypted or password-protected PDFs are not supported.',
    zoomIn: 'Zoom in',
    zoomOut: 'Zoom out',
    "failed": "The operation failed. Check the connection and retry.",
    "newTerminal": "New terminal",
    "closeTerminal": "End terminal",
    "connecting": "Connecting to terminal…",
    "creating": "Creating terminal…",
    "exited": "Terminal exited",
    "disconnected": "Terminal disconnected; input will not be resent automatically.",
    "permissionUnavailable": "Could not load permissions. Update the Host Remote plugin and retry.",
    "enter": "Enter",
    "keyboard": "Keyboard",
    "interrupt": "Interrupt",
    "tab": "Tab",
    "escape": "Esc",
    "up": "Up",
    "down": "Down",
    "left": "Left",
    "right": "Right",
    "backspace": "Backspace"
},
  common: {
    back: 'Back', retry: 'Retry', close: 'Close', cancel: 'Cancel', refresh: 'Refresh', delete: 'Delete', unavailable: 'Unavailable', unknown: 'Unknown',
  },
  app: {
    oauthCancelled: 'Authorization was not completed. Please try again.', oauthInvalid: 'Your sign-in information is no longer valid. Please sign in again.',
    loadingTagline: 'Connect once. Ready whenever you are.', loadingIdentity: 'Preparing secure identity…', bootFailed: 'DSH Remote could not start', secureStorageUnavailable: 'Secure data on this phone is temporarily unavailable. Please try again.',
    deviceUnavailable: 'This device could not be found', deviceNoLongerTrusted: 'It may have been removed or signed out of the current account.', backToDevices: 'Back to devices',
  },
  status: { online: 'Online', offline: 'Offline', disconnected: 'Disconnected', lan: 'Direct LAN', relay: 'Server relay', p2p: 'Direct P2P', turn: 'TURN relay', waiting: 'Connecting', running: 'Running' },
  setup: {
    title: 'Sign in', signIn: 'Sign in to your account', signInAgain: 'Sign in again', lead: 'Authorize this phone to see devices on the same account and continue your conversations.',
    oauth: 'Zhihu', githubOAuth: 'GitHub', passwordMethod: 'Email', zhihu: 'Continue with Zhihu', github: 'Continue with GitHub', oauthHint: 'A browser will open to finish authorization, then return here automatically.',
    email: 'Email', emailPlaceholder: 'Enter your email', password: 'Password', passwordPlaceholder: 'Enter your password', passwordHint: 'Your password is used only for this sign-in and is not stored on your phone.',
    server: 'Server address', serverHint: 'Use an HTTPS address.', trustTitle: 'Protect your devices and conversations', trustBody: 'Conversation data is encrypted in transit. Only trusted devices signed in to the same account can access it.',
  },
  settings: {
    title: 'Settings', thisPhone: 'This phone', androidDevice: 'Android device', connection: 'Connection', server: 'Server', account: 'Account', loginMethod: 'Sign-in method', protocol: 'Protocol', notConfigured: 'Not configured', notSignedIn: 'Not signed in',
    language: 'Language', languageSystem: 'System default', languageChinese: '简体中文', languageEnglish: 'English', languageNote: 'With System default, the app follows the Android language setting automatically.',
    theme: 'Dark mode', themeLight: 'Light', themeDark: 'Dark', themeSystem: 'System',
    chat: 'Chat',
    transport: 'Connection method', transportNote: 'Changing this reconnects the device. If a direct connection fails, the app automatically falls back to the server relay.', identity: 'Identity on this phone', deviceId: 'Device ID', publicKey: 'Security key', keyNote: 'The security key is encrypted by Android and never leaves this phone.',
    about: 'About', aboutLead: 'View the current version, source code, and updates', developer: 'Developer', developerValue: '知乎@李国宝', appVersion: 'Current version', sourceCodeUrl: 'Source code', updateUrl: 'Updates', linkFailedTitle: 'Could not open link', linkFailedBody: 'Check your connection, or copy the address and open it in a browser.',
    more: 'More', checkUpdates: 'Check for updates', checkingUpdates: 'Checking for updates…', updateFoundTitle: 'New version available', updateFoundBody: (latest: string, current: string) => `Version v${latest} is available. Current version: ${current}.`, downloadUpdate: 'Download update', openUpdates: 'Open updates', downloadingUpdate: 'Downloading update', downloadFailedTitle: 'Download failed', downloadFailedBody: 'Could not download the latest package. Please check your connection and try again.', installFailedTitle: 'Could not open the installer', installFailedBody: 'The package was downloaded but the installer could not open. Allow this app to install unknown apps, then try again.', openInstallSettings: 'Open settings', upToDateTitle: 'You are up to date', upToDateBody: 'You are already on the latest version.', checkFailedTitle: 'Update check failed', checkFailedBody: 'Please check your connection and try again.',
    signOut: 'Sign out', resetLocal: 'Clear local data', resetTitle: 'Clear data on this phone?', resetBody: 'This removes server settings, sign-in information, and trusted devices. You will need to sign in again. This cannot be undone.', reset: 'Clear data', signOutTitle: 'Sign out of this account?', signOutBody: 'You will need to sign in again to access your devices.',
  },
  devices: {
    title: 'Devices', myDevices: 'My devices', lead: 'Choose a device to continue your work', footer: 'Continue your work anytime.', favorites: 'Favorites', recent: 'Recently visited', openFavorite: (title: string, device: string) => `Open “${title}” on ${device} from Favorites`, openRecent: (title: string, device: string) => `Open recently visited “${title}” on ${device}`, removeFavorite: (title: string) => `Remove “${title}” from Favorites`, emptyTitle: 'No devices available', emptyBody: 'Install the DSH Remote plugin on your computer and sign in to the same account. The device will appear here.', options: 'Manage device', encrypted: 'Secure connection',
    connectionInterrupted: 'Connection interrupted', trustExplanation: 'After confirmation, this phone remembers the device’s secure identity. If that identity changes, the connection stops to protect your data.', trust: 'Trust and continue', connectReady: 'Connect to view and continue conversations on your computer.', offlineHelp: 'This device is offline. Make sure the DSH Remote plugin is running on your computer.', secureConnect: 'Connect securely',
    connectingTitle: 'Connect device', connecting: 'Connecting', connectionReady: 'Ready', retryConnection: 'Connect again', cancelConnection: 'Cancel connection', openInfo: 'View device and connection information',
    connectionProbeLabels: {
      lan: 'Probing local direct path',
      p2p: 'Probing peer-to-peer path',
      turn: 'Probing TURN relay',
      relay: 'Preparing server relay',
    },
    connectionProbeDetails: {
      lan: 'Local direct',
      p2p: 'Peer-to-peer',
      turn: 'TURN relay',
      relay: 'Server relay',
    },
    connectionSteps: {
      authenticating: { title: 'Verify device', body: 'Confirm account and device access' },
      transport: { title: 'Choose a connection path', body: 'Try LAN, P2P, or server relay' },
      secure: { title: 'Open a secure channel', body: 'Verify device identity and complete encryption' },
      loading: { title: 'Load workspaces', body: 'Sync workspaces and conversations' },
    },
    info: 'Device information', harness: 'DeepSeek Harness', provider: 'Model provider', directory: 'Current directory', model: 'Current model', workspaces: 'Workspaces', conversations: 'Conversations', secureConnection: 'Connection information', path: 'Connection method', probeOrder: 'Probe order', encryption: 'Security', viewWorkspaces: 'View workspaces and conversations', unknownVersion: 'Version unavailable',
    networkDetails: 'Network details', phoneEndpoint: 'Phone endpoint', computerEndpoint: 'Computer endpoint', relayEndpointUnavailable: 'Not exposed over server relay', connectionServer: 'Connection server', networkProtocol: 'Network protocol', candidatePath: 'Candidate path', roundTripTime: 'Round-trip time', availableBitrate: 'Available uplink', traffic: 'Connection traffic', connectedAt: 'Connected at', sent: 'sent', received: 'received',
    forgetTitle: (name: string) => `Stop trusting “${name}”?`, forgetBody: 'After removal, you will need to confirm this device again the next time you connect.', forget: 'Remove device',
  },
  sessions: { title: 'Conversations', new: 'New conversation', deviceTitle: 'Conversations on this device', lead: 'Continue where you left off', creating: 'Creating a conversation…', emptyTitle: 'No conversations yet', emptyBody: 'Create a conversation, or start working in DeepSeek Harness on your computer first.', archived: (count: number) => `${count} archived`, continue: 'Continue conversation', untitled: 'New conversation', child: 'Subtask conversation' },
  time: { unavailable: 'Update time unavailable', lastSeenUnavailable: 'Active time unavailable', lastActive: (value: string) => `Active ${value}`, now: 'just now', justNow: 'Updated just now', minutesAgo: (n: number) => `${n} min ago`, hoursAgo: (n: number) => `${n} hr ago`, updatedSuffix: '', locale: 'en-US' },
  transport: { auto: 'Automatic (recommended)', autoDescription: 'Tries direct P2P first, then TURN or the server relay when needed', turn: 'Prefer TURN', turnDescription: 'Prioritizes TURN relay for stability on restricted networks', relay: 'Server relay only', relayDescription: 'Routes all data through the DSH Remote server relay' },
  workspaces: {
    title: 'Workspaces', create: 'New workspace', type: 'Workspace type', dsh: 'DSH', deviceTitle: (name: string) => name, deviceInfo: 'Device and connection information',
    deviceSubtitle: (name: string, status: string) => `${name} · ${status}`, noDevice: 'No device connected',
    emptyTitle: 'No workspaces yet', emptyBody: 'Choose a project directory on your computer to organize related conversations.', search: 'Search workspaces', clearSearch: 'Clear search', noSearchResults: 'No workspaces found', noSearchResultsBody: 'Try another workspace name or directory path.', options: 'Manage workspace', addFavorite: (title: string) => `Add “${title}” to Favorites`, removeFavorite: (title: string) => `Remove “${title}” from Favorites`, favoriteUnavailable: 'This workspace in Favorites is no longer on the computer. It may have been deleted.', noSessions: 'No conversations yet. Tap to create one.', loadAllSessions: 'Load all', unnamedSession: 'Untitled conversation', codex: 'CodeX', cursor: 'Cursor', antigravity: 'Antigravity',
    deleteTitle: (title: string) => `Delete “${title}”?`, deleteBody: 'This removes the workspace and all of its conversations from this device. This cannot be undone.', delete: 'Delete workspace', rename: 'Rename', moveUp: 'Move up', moveDown: 'Move down', expandWorkspace: (title: string) => `Expand workspace “${title}”`, collapseWorkspace: (title: string) => `Collapse workspace “${title}”`, newSessionIn: (title: string) => `New conversation in “${title}”`, deviceDirectory: 'Project directory on computer', browse: 'Choose directory', directoryHint: 'Conversations created here will use this directory.', codexDirectoryHint: 'The selected directory will be added to the CodeX project catalog on the computer.', cursorDirectoryHint: 'The selected directory becomes the Cursor ACP session cwd (kept only for this phone connection).', antigravityDirectoryHint: 'Use this directory for AGY conversations. Existing conversations are loaded from the computer.', renameTitle: 'Rename workspace', namePlaceholder: 'Enter a workspace name', saveName: 'Save', chooseFolder: 'Choose project directory', loading: 'Loading…', loadingDirectory: 'Reading directory…', noFolders: 'No folders are available here', showHidden: 'Show hidden folders', hideHidden: 'Hide hidden folders', chooseThisFolder: 'Use this directory',
  },
  chat: {
    quickCheckChanges: 'Review changes', quickCheckChangesPrompt: 'Review the current code changes and point out any issues.', quickCommit: 'Commit changes', quickCommitPrompt: 'Review the current changes and commit them directly without asking for confirmation.', quickViewScreenshot: 'Review screenshot', quickViewScreenshotPrompt: 'Review the latest screenshot and check for interface issues.',
    fullAccessTitle: 'Enable full access?', fullAccessBody: 'Full access lets DeepSeek Harness modify files and run commands directly. Enable it only when you trust the current task.', codexFullAccessTitle: 'Give CodeX full computer access?', codexFullAccessBody: 'CodeX will be able to access every file on the computer without asking again for command or file-change approval on later turns. Enable it only when you fully trust this task.', enable: 'Enable full access', stop: 'Stop response', selectModel: 'Choose model', selectReasoningEffort: 'Choose thinking level', reasoningEffortLabel: (name: string) => `Thinking level: ${name}`, approvalMode: 'Permissions', approvalModeLabel: (name: string) => `Permissions: ${name}`, reconnect: 'Reconnect current conversation', reconnecting: 'Restoring this conversation…', offline: 'The connection to this device was lost. Use the refresh button above to reconnect and continue this conversation.', hostOperation: (name: string) => `${name} on computer`,
    toolRunning: (name: string) => `Running ${name}`, processRunning: 'Analyzing request', older: 'View earlier messages', messageLabel: 'Message DeepSeek Harness', codexMessageLabel: 'Message CodeX', cursorMessageLabel: 'Message Cursor', antigravityMessageLabel: 'Message Antigravity', placeholder: 'Type a message…', codexPlaceholder: 'Give CodeX a task…', cursorPlaceholder: 'Give Cursor a task…', antigravityPlaceholder: 'Give Antigravity a task…', send: 'Send', addImages: 'Add images', removeImage: (name: string) => `Remove image “${name}”`, unnamedImage: 'Image', imageLimitTitle: 'Could not add images', tooManyImages: (max: number) => `You can add up to ${max} images to each message.`, unsupportedImage: (name: string) => `“${name}” is not supported. Choose a PNG, JPEG, WebP, or GIF image.`, imageTooLarge: (name: string, max: string) => `“${name}” exceeds the ${max} per-image limit.`, imagesTooLarge: (max: string) => `These images exceed the combined ${max} limit.`, imageDimensionsTooLarge: (name: string, max: number) => `The width or height of “${name}” exceeds ${max} pixels.`, imagePixelsTooLarge: (name: string) => `“${name}” exceeds the image pixel limit.`, imagePickerFailedTitle: 'Could not read image', imagePickerFailedBody: 'Choose a PNG, JPEG, WebP, or GIF image and try again.', policyHint: 'Messages are encrypted throughout. Remote operations remain subject to DeepSeek Harness permissions on your computer.', codexPolicyHint: 'Messages are encrypted throughout. Remote operations remain subject to CodeX permissions on your computer.', cursorPolicyHint: 'Messages are encrypted throughout. Remote operations remain subject to Cursor ACP permissions; text prompts only for now.', antigravityPolicyHint: 'Messages are encrypted throughout. Images use a private temporary cache on your computer; AGY reads them with its image tool.', you: 'You', system: 'System', generating: 'DeepSeek is working', codexGenerating: 'Thinking', cursorGenerating: 'Thinking', antigravityGenerating: 'Thinking', stopping: 'Stopping response', reasoning: 'Think', reasoningActive: 'Thinking', reasoningExpand: 'Expand thinking process', reasoningCollapse: 'Collapse thinking process', failed: 'Not completed', completed: 'Completed', toolCall: 'Call details', toolResult: 'Result', toolExpand: (name: string) => `Show “${name}” details`, toolCollapse: (name: string) => `Hide “${name}” details`, toolTruncated: 'This content is too long. Only the first 64 KB is shown.', denied: 'Denied', allowedOnce: 'Allowed once', approvalHandled: 'Handled on another device', permissionTitle: 'Allow this operation?', permissionScope: 'Permission applies only to this request. Other operations will still require confirmation.', allowOnce: 'Allow once', deny: 'Deny', answered: 'Answered', questionCancelled: 'Question cancelled', questionTitle: 'DeepSeek Harness needs your confirmation', answerToContinue: 'Answer to continue', submitAnswer: 'Submit answer', welcomeSlogan: 'Into the Unknown', moreActions: 'More actions', openWorkspaces: 'Workspaces', welcomeBadge: 'Preview', takePhoto: 'Camera', photos: 'Photos', files: 'Files', mode: 'Mode', selectMode: 'Select mode', modeDefault: 'Default', reasoningEffort: 'Reasoning effort', reasoningEffortDefault: 'Default', toolAccess: 'Tool access', quickPrompts: 'Prompts', toolPrompts: 'Prompts', toolFilesDescription: 'Browse files and folders on the computer', toolTerminalDescription: 'Run commands on the computer', toolPromptsDescription: 'Frequent prompts; tap one to send it', toolPromptEdit: 'Edit prompts', toolPromptEditDescription: 'Add, remove or edit frequent prompts', toolPromptAdd: 'New prompt', toolPromptEditTitle: (title: string) => `Edit “${title}”`, toolPromptTitlePlaceholder: 'Prompt name', toolPromptTextPlaceholder: 'Prompt text', toolPromptSave: 'Save', toolPromptSaveFailedTitle: 'Could not save prompts', toolPromptSaveFailedBody: 'Failed to write to local storage. Please try again.', toolPromptDeleteTitle: (title: string) => `Delete “${title}”?`, toolPromptDeleteBody: 'This cannot be undone.', toolPromptEmptyTitle: 'No prompts yet', toolPromptEmptyBody: 'Tap “Edit prompts” to add a frequent prompt.', toolPromptSent: (title: string) => `Sent “${title}”`, toolPromptSendFailed: 'Could not send. Check the connection and try again.', newChat: 'New chat', newChatFailedTitle: 'Could not start a new chat', newChatFailedBody: 'Check the connection and try again.', selectWorkspace: 'Choose workspace', moveSessionHint: 'Move this conversation into the chosen workspace', workspaceNone: 'No workspace', workspacePickerEmptyTitle: 'No workspaces yet', workspacePickerEmptyBody: 'Add a project directory in DeepSeek Harness on the computer, then move conversations into it.', manageWorkspaces: 'Manage workspaces', moveStartedTitle: 'This conversation cannot be moved', moveStartedBody: (name: string) => `This conversation already started in another directory and its working directory cannot change. Start a new conversation in “${name}” instead?`, moveStartedConfirm: 'Start a new conversation', moveFailedTitle: 'Could not start a conversation in this workspace', moveFailedBody: 'Check the connection and try again.', modeLockedTitle: 'Can’t switch mode', modeLockedBody: 'This conversation has already started. The mode can only change before the first message. Start a new conversation to choose one.', modeSelectFailedBody: 'The mode could not be switched. Check the connection and try again.', modeLoadFailed: 'Could not load modes. Reopen “More actions” to retry.', cameraPermissionTitle: 'Camera unavailable', cameraPermissionBody: 'Allow DSH Remote to use the camera in system settings.', filePickerFailedTitle: 'Could not read file', filePickerFailedBody: 'Choose a PNG, JPEG, WebP, or GIF image and try again.', permissionReadOnly: 'Read Only', permissionReadOnlyDescription: 'Read-only access; file changes and commands each need your confirmation.', permissionWorkspaceWrite: 'Workspace Write', permissionWorkspaceWriteDescription: 'Write files and run commands inside the current workspace; wider access still needs approval.', permissionFullAccess: 'Full Access', permissionFullAccessDescription: 'No per-action approval. Files can be modified and commands run directly. Only use when you trust the task.', presetStandardName: 'Standard', presetStandardDescription: 'Handles code, files, and research for most tasks, using search, editing, and terminal tools as needed.', presetPtcName: 'PTC', presetPtcDescription: 'Everything in Standard, tuned for calling tools in batches and then filtering, deduplicating, and summarizing the results.', presetMinimalName: 'Minimal', presetMinimalDescription: 'Uses only the terminal tool, useful for testing and comparing baseline behavior.', presetCordisName: 'Creator', presetCordisDescription: 'Customize DSH by conversation: let the agent write plugins that add features or UI, or combine tools and prompts into your own mode.', welcomeTitle: 'Continue this conversation', welcomeBody: 'Tell DeepSeek Harness what you want to inspect, explain, or change. You can also add images. Any operation requiring confirmation will appear directly in the conversation.', codexWelcomeTitle: 'Continue this CodeX conversation', codexWelcomeBody: 'Tell CodeX what you want to inspect, explain, or change. You can also add images. Command or file-change approvals will appear directly in the conversation.', cursorWelcomeTitle: 'Continue this Cursor conversation', cursorWelcomeBody: 'Tell Cursor what you want to inspect, explain, or change. Permission requests appear directly in the conversation. Remote prompts are text-only for now.', antigravityWelcomeTitle: 'Continue this Antigravity conversation', antigravityWelcomeBody: 'Tell AGY what you want to inspect, explain, or change. You can also attach images.',
    codexWorkspaceWrite: 'Workspace write', codexWorkspaceWriteDescription: 'Can write in the current project; broader command and file access still needs one-time approval.', codexFullAccess: 'Full access', codexFullAccessDescription: 'Lets CodeX access every file on the computer without asking again for later operations.', codexCommand: 'CodeX command', codexFileChange: 'CodeX file change', codexWebSearch: 'CodeX web search', codexSubagent: 'CodeX subagent', codexPlan: 'CodeX plan', codexOperation: 'CodeX operation', codexError: 'CodeX did not complete the operation.',
  },
  mention: {
    addSection: 'Add', commandSection: 'Commands', skillSection: 'Skills', sessionSection: 'Sessions', fileSection: 'Files',
    file: 'File', fileDescription: 'Reference a file on the computer',
    goal: 'Goal', goalDescription: 'Set or view the goal for a long-running task',
    plan: 'Plan', planDescription: 'Enter or leave plan mode',
    feedback: 'Feedback', feedbackDescription: 'Record feedback about this session',
    compact: 'Compact', compactDescription: 'Compact older conversation history',
    permission: 'Permission', permissionDescription: 'Switch the permission preset (sandbox mode + approval policy)',
    model: 'Model', modelDescription: 'Choose the model used by this session',
    export: 'Export', exportDescription: 'Download this Session log as a ZIP archive',
    exportTitle: 'Session export', exportTriggered: 'Export was triggered.', exportFailed: 'Export failed. Try again later.',
    skillUserOnly: 'user-only', noMatches: 'No matches',
    builtinOfficeDocx: 'Create, read, edit, and check Word documents (.docx), including reports, letters, and formatted tables.',
    builtinOfficePptx: 'Create, read, edit, and check PowerPoint presentations (.pptx), including slide text, tables, images, and charts.',
    builtinOfficeXlsx: 'Read, create, and modify Excel workbooks (.xlsx), including data, formulas, and formatting.',
    builtinDshBadge: 'Add the official “powered by dsh” badge to documents, pull requests, merge requests, and other content.',
  },
  validation: { serverRequired: 'Enter a server address.', serverInvalid: 'The server address is invalid. Example: https://remote.example.com', httpsRequired: 'Use an HTTPS address. HTTP is allowed for local development.', serverPartsForbidden: 'Enter only the server address, without account information, query parameters, or a page fragment.' },
  runtime: {
    identityNotReady: 'This phone is not ready yet. Please try again shortly.', zhihuUnsupported: 'This server does not support Zhihu authorization. Try another sign-in method.', githubUnsupported: 'This server does not support GitHub authorization. Try another sign-in method.', hostClosed: 'The connection to this device was lost.', openSessionFirst: 'Open a conversation before responding to this request.', networkUnavailable: 'No network is available. The app will try to reconnect when the network returns.', connectHostFirst: 'Connect to your computer first.', codexUnavailable: 'CodeX Remote is not enabled on this device, or CodeX is currently unavailable.', codexInvalidResponse: 'CodeX Remote returned data the app could not recognize.', codexTurnUnavailable: 'This CodeX turn belongs to another connection and cannot be stopped from the phone.', codexWorkspaceReadOnly: 'CodeX workspaces can be added here, but renaming, reordering, and deletion remain managed by CodeX on the computer.', cursorUnavailable: 'Cursor Remote is not enabled on this device, or Cursor ACP is currently unavailable.', antigravityUnavailable: 'Antigravity Remote is not enabled on this device, or Antigravity ACP is currently unavailable.', cursorTextOnly: 'Cursor Remote currently supports text messages only, not images.', hostMissingKey: 'This device has no security key. Verify and trust it again.', unexpectedRelayDevice: 'The secure connection does not match the selected device.', secureChannelNotConnected: 'The secure connection has not been established.', secureHandshakeTimedOut: 'The secure connection timed out. Try again.', secureHandshakeOrder: 'The secure connection handshake was out of order.', secureHandshakeIncomplete: 'The secure connection handshake did not complete.', secureHandshakeFailed: 'The secure connection handshake failed.',
  },
  messageActions: {
    copy: 'Copy answer', copied: 'Copied', good: 'Good response', bad: 'Bad response', branch: 'Branch in a new chat',
    unavailable: 'This Host or message does not support this action', failed: 'Action not completed', feedbackSaved: 'Feedback saved on the Host',
    usageUnavailable: 'Usage unavailable', timeUnavailable: 'Time unavailable', usage: 'Actual usage', input: 'Input', output: 'Output',
    cacheRead: 'Cache read', cacheWrite: 'Cache write', reasoning: 'Reasoning', total: 'Total',
  },
  chatProcess: {
    processActivity: {
      "thinking": {
        "running": "Analyzing the request",
        "done": "Analysis completed"
      },
      "read": {
        "running": "Reading files",
        "done": "Read files"
      },
      "readImage": {
        "running": "Reading images",
        "done": "Read images"
      },
      "write": {
        "running": "Writing files",
        "done": "Wrote files"
      },
      "search": {
        "running": "Searching code",
        "done": "Searched code"
      },
      "edit": {
        "running": "Editing files",
        "done": "Edited files"
      },
      "commands": {
        "running": "Running commands",
        "done": "Ran commands"
      },
      "code": {
        "running": "Running code",
        "done": "Ran code"
      },
      "webSearch": {
        "running": "Searching the web",
        "done": "Searched the web"
      },
      "webFetch": {
        "running": "Visiting web pages",
        "done": "Visited web pages"
      },
      "subagents": {
        "running": "Coordinating subagents",
        "done": "Coordinated subagents"
      },
      "plan": {
        "running": "Updating the plan",
        "done": "Updated the plan"
      },
      "questions": {
        "running": "Waiting for your action",
        "done": "Asked questions"
      },
      "tools": {
        "running": "Calling tools",
        "done": "Called tools"
      }
    },
    stopped: "Stopped",
    join: ", ",
    more: ", etc.",
    sharedPrefix: '',
    joinTwo: (first: string, second: string) => `${first} and ${second}`,
    toolTitles: {
      bash: 'Bash', pwsh: 'PowerShell', read: 'Read', read_image: 'Read image', write: 'Write', edit: 'Edit',
      apply_patch: 'Edit', grep: 'Grep', glob: 'Glob', run_code: 'Code', web_search: 'Web search', web_fetch: 'Web fetch',
    },
  },
  trajectory: {
    expand: 'Expand entry', collapse: 'Collapse entry', clearSearch: 'Clear search', attachments: (count: number) => `${count} image${count === 1 ? '' : 's'}`,
    noText: 'No text content',
    open: 'Switch to trajectory', close: 'Switch to conversation', title: 'Trajectory', all: 'All', system: 'System', user: 'User',
    context: 'Context', assistant: 'Assistant', tool: 'Tool', search: 'Search messages, tools or turns', turn: 'Turn', empty: 'No matching loaded trajectory',
    loadedOnly: 'Only real loaded messages are shown. Load older history to extend the trajectory.',
  },
  errors: {
    ACCOUNT_AUTH_REQUIRED: 'Sign in before connecting this phone.', AUTH_INVALID: 'Your sign-in is no longer valid. Sign in again.', AUTH_REQUIRED: 'Sign in again to continue.', TOKEN_EXPIRED: 'Your sign-in expired. Sign in again.', TOKEN_REUSED: 'This phone was signed out to protect your account. Sign in again.', DEVICE_NOT_FOUND: 'This device could not be found. Refresh the device list.', DEVICE_REVOKED: 'This phone was removed from the account. Sign in again.', DEVICE_OWNERSHIP_REQUIRED: 'The sign-in information on this phone is no longer valid. Sign in again.', MEMBERSHIP_REQUIRED: 'You no longer have access to this device. Make sure both devices use the same account.', HOST_OFFLINE: 'This device is offline. Make sure DeepSeek Harness and the DSH Remote plugin are running.', DEVICE_OFFLINE: 'This device is offline. Make sure DeepSeek Harness and the DSH Remote plugin are running.', PEER_IDENTITY_MISMATCH: 'The secure identity of this device changed. Verify the device, then trust it again.', RATE_LIMITED: 'Too many operations. Try again later.', CONNECTION_FAILED: 'Could not connect to this device. Check your network and try again.', P2P_FAILED: 'Direct connection failed. Switching to the server relay.', RELAY_UNAVAILABLE: 'The server relay is temporarily unavailable. Try again later.', TURN_UNAVAILABLE: 'A stable connection could not be established. Trying another method.', SECURE_CHANNEL_FAILED: 'A secure connection could not be established. Try again.', RPC_TIMEOUT: 'The device took too long to respond. Try again.', UNSUPPORTED_VERSION: 'This DSH Remote version is incompatible. Update the app and try again.', METHOD_NOT_ALLOWED: 'The current settings do not allow this operation from your phone.', PERMISSION_NOT_PENDING: 'This request was already handled or has expired.', SESSION_NOT_FOUND: 'This conversation could not be found. Return to the conversation list and refresh.', HARNESS_UNAVAILABLE: 'DeepSeek Harness is temporarily unavailable on this device. Make sure it is running.', AGENT_BUSY: 'DeepSeek Harness is processing another operation. Try again shortly.', FULL_RESYNC_REQUIRED: 'The conversation changed on your computer. Reopen it to continue.',
    CODEX_UNAVAILABLE: 'CodeX is unavailable on this device. Make sure CodeX Remote is enabled and CodeX is signed in on the computer.', CODEX_TURN_OWNED: 'Another device is operating this CodeX turn. Try again later.', CODEX_APPROVAL_NOT_FOUND: 'This CodeX approval was already handled or has expired.', CODEX_PATH_NOT_ALLOWED: 'This directory is not present in the CodeX workspace catalog on the computer.', FEATURE_NOT_SUPPORTED: 'The computer does not support this feature. Update the DSH Remote plugin.', INVALID_MESSAGE: 'The server returned data the app could not recognize. Try again later.', serverUnreachable: 'Could not connect to the server. Check the server address and your network.', unknown: 'The operation was not completed. Try again.',
  },
} satisfies Messages

export default enUS
