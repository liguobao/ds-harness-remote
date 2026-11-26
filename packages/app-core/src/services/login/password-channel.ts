import type { ImmediateLoginChannel } from './types'
import { serverSession } from '../server-session'

export type PasswordLoginInput =
  | { email: string; password: string }
  | { challenge: string; code: string }

export const passwordLoginChannel: ImmediateLoginChannel<PasswordLoginInput> = {
  method: 'password',
  busyAction: 'server',

  async signIn({ baseUrl, identity, publicApi, recoverIdentity }, input) {
    const login = 'challenge' in input
      ? await publicApi.verifyAccountLogin(input.challenge, input.code)
      : await publicApi.loginAccount(input.email, input.password)
    const { credentials } = await serverSession.registerWithAccountToken(
      baseUrl,
      identity,
      login.token,
      login.account,
      recoverIdentity,
    )
    return {
      account: credentials.account ?? login.account,
      loginMethod: 'password',
    }
  },
}
