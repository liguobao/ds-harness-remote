import { RemoteServerApi } from './api'
import { ServerSessionManager } from './server-session-manager'
import { loadDeviceCredentials, saveDeviceCredentials } from './storage'

export { ServerSessionManager } from './server-session-manager'
export type { ApiFactory, AuthenticatedServer, CredentialPersistence } from './server-session-manager'

export const serverSession = new ServerSessionManager(
  { load: loadDeviceCredentials, save: saveDeviceCredentials },
  (baseUrl, accessToken) => new RemoteServerApi(baseUrl, accessToken),
)
