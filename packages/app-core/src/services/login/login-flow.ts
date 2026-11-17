import { normalizeServerUrl } from '../../lib/server-url'
import type { DeviceIdentity } from '../../types'
import { RemoteServerApi } from '../api'
import type {
  ImmediateLoginChannel,
  LoginChannelContext,
  LoginOutcome,
  RedirectLoginChannel,
} from './types'

export class LoginFlow {
  async createContext(baseUrl: string, identity: DeviceIdentity): Promise<LoginChannelContext> {
    const normalized = normalizeServerUrl(baseUrl)
    const publicApi = new RemoteServerApi(normalized)
    await publicApi.health()
    return { baseUrl: normalized, identity, publicApi }
  }

  signInWith<TInput>(
    channel: ImmediateLoginChannel<TInput>,
    context: LoginChannelContext,
    input: TInput,
  ): Promise<LoginOutcome> {
    return channel.signIn(context, input)
  }

  prepareRedirect(
    channel: RedirectLoginChannel,
    context: LoginChannelContext,
  ): Promise<string> {
    return channel.prepareRedirect(context)
  }

  completeRedirect(
    channel: RedirectLoginChannel,
    context: LoginChannelContext,
    accountToken: string,
  ): Promise<LoginOutcome> {
    return channel.completeSignIn(context, accountToken)
  }
}

export const loginFlow = new LoginFlow()
