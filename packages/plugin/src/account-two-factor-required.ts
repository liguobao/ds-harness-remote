export class AccountTwoFactorRequired extends Error {
  readonly code = 'TWO_FACTOR_REQUIRED'

  constructor(readonly challenge: string, readonly serverUrl: string) {
    super('Two-factor verification is required.')
  }
}
