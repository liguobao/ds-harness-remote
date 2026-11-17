import type { RemoteServerApi } from '../api'
import type { DeviceIdentity, LoginMethod } from '../../types'

/** Shared inputs for every login channel invocation. */
export interface LoginChannelContext {
  baseUrl: string
  identity: DeviceIdentity
  publicApi: RemoteServerApi
}

/** Result of a completed login; device credentials are persisted separately. */
export interface LoginOutcome {
  account: string
  loginMethod: LoginMethod
}

/**
 * Single-step login: the channel obtains an account token and registers the
 * device before returning.
 */
export interface ImmediateLoginChannel<TInput> {
  readonly method: LoginMethod
  readonly busyAction: string
  signIn(context: LoginChannelContext, input: TInput): Promise<LoginOutcome>
}

/**
 * Two-step login: the UI opens an external redirect, then resumes with the
 * delivered account token.
 */
export interface RedirectLoginChannel {
  readonly method: LoginMethod
  readonly prepareBusyAction: string
  readonly completeBusyAction: string
  prepareRedirect(context: LoginChannelContext): Promise<string>
  completeSignIn(context: LoginChannelContext, accountToken: string): Promise<LoginOutcome>
}
