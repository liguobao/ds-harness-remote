import type { ImmediateLoginChannel } from './types'
import { serverSession } from '../server-session'

export interface PasswordLoginInput {
  email: string
  password: string
}

export const passwordLoginChannel: ImmediateLoginChannel<PasswordLoginInput> = {
  method: 'password',
  busyAction: 'server',

  async signIn({ baseUrl, identity, publicApi }, { email, password }) {
    const login = await publicApi.loginAccount(email, password)
    const { credentials } = await serverSession.registerWithAccountToken(
      baseUrl,
      identity,
      login.token,
      login.account,
    )
    return {
      account: credentials.account ?? login.account,
      loginMethod: 'password',
    }
  },
}
