import { strings as zhCN } from '../../locales/i18n'
import { createOAuthRedirectChannel } from './oauth-redirect-channel'

export const oauthLoginChannel = createOAuthRedirectChannel({
  method: 'oauth',
  providerId: 'zhihu',
  unsupportedError: zhCN.runtime.zhihuUnsupported,
})

export const githubOAuthLoginChannel = createOAuthRedirectChannel({
  method: 'github-oauth',
  providerId: 'github',
  unsupportedError: zhCN.runtime.githubUnsupported,
})

export const googleOAuthLoginChannel = createOAuthRedirectChannel({
  method: 'google-oauth',
  providerId: 'google',
  unsupportedError: zhCN.runtime.googleUnsupported,
})
