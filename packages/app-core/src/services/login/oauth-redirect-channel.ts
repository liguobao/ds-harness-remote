import type { LoginMethod } from '../../types'
import { serverSession } from '../server-session'
import type { RedirectLoginChannel } from './types'

export const oauthReturnTo = 'dshremote://oauth'

export function createOAuthRedirectChannel(options: {
  method: LoginMethod
  providerId: string
  unsupportedError: string
}): RedirectLoginChannel {
  return {
    method: options.method,
    prepareBusyAction: 'oauth',
    completeBusyAction: 'server',

    async prepareRedirect({ baseUrl, publicApi }) {
      const provider = (await publicApi.oauthProviders()).find(item => item.id === options.providerId)
      if (provider === undefined) throw new Error(options.unsupportedError)
      const url = new URL(`${baseUrl}${provider.startUrl}`)
      url.searchParams.set('return_to', oauthReturnTo)
      return url.toString()
    },

    async completeSignIn({ baseUrl, identity, publicApi }, accountToken) {
      const profile = await publicApi.accountMe(accountToken)
      const { credentials } = await serverSession.registerWithAccountToken(
        baseUrl,
        identity,
        accountToken,
        profile.account,
      )
      return {
        account: credentials.account ?? profile.account,
        loginMethod: options.method,
      }
    },
  }
}
