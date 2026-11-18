export { loginFlow, LoginFlow } from './login-flow'
export { githubOAuthLoginChannel, googleOAuthLoginChannel, oauthLoginChannel } from './oauth-channel'
export { passwordLoginChannel, type PasswordLoginInput } from './password-channel'
export type {
  ImmediateLoginChannel,
  LoginChannelContext,
  LoginOutcome,
  RedirectLoginChannel,
} from './types'

import type { RedirectLoginMethod } from '../../types'
import { githubOAuthLoginChannel, googleOAuthLoginChannel, oauthLoginChannel } from './oauth-channel'
import type { RedirectLoginChannel } from './types'

export const redirectLoginChannels: Record<RedirectLoginMethod, RedirectLoginChannel> = {
  oauth: oauthLoginChannel,
  'github-oauth': githubOAuthLoginChannel,
  'google-oauth': googleOAuthLoginChannel,
}

export function redirectLoginChannelFor(method: RedirectLoginMethod | undefined): RedirectLoginChannel {
  return redirectLoginChannels[method ?? 'oauth']
}
