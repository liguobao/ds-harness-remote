export class DeviceIdentity {
  deviceId: string = '';
  name: string = '';
  platform: string = '';
  privateKey: string = '';
  publicKey: string = '';
}

export class TokenPair {
  accessToken: string = '';
  accessTokenExpiresAt: number = 0;
  refreshToken: string = '';
  refreshTokenExpiresAt: number = 0;
}

export class AccountLoginResult {
  token: string = '';
  expiresAt: number = 0;
  account: string = '';
  isAdmin: boolean = false;
}

export class RemoteHostDevice {
  deviceId: string = '';
  name: string = '';
  platform: string = '';
  membershipId: string = '';
  identityKey: string = '';
  online: boolean = false;
  clientVersion: string = '';
  harnessVersion: string = '';
  lastSeenAt: number = 0;
  /** False when the Server omitted the presence fields, so they must be fetched explicitly. */
  presenceKnown: boolean = false;
}

export class AuthorizedPeerDevice {
  deviceId: string = '';
  name: string = '';
  role: string = '';
  platform: string = '';
  identityKey: string = '';
  membershipId: string = '';
  online: boolean = false;
  lastSeenAt: number = 0;
  presenceKnown: boolean = false;
  clientVersion: string = '';
  harnessVersion: string = '';
}

export class ChatMessage {
  role: string = '';
  text: string = '';
  toolName: string = '';
  reasoning: string = '';
  kind: string = '';
}
