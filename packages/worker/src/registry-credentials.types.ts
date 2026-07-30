export type RegistryCredentialAccess = 'cleanup' | 'pull' | 'push';

export interface RegistryCredentialPayload {
  access: RegistryCredentialAccess;
  cacheTag?: string | undefined;
  expiresAt?: number | undefined;
  projectId: string;
  repository?: string | undefined;
  tag?: string | undefined;
  version: 1;
}

export interface RegistryCredential {
  password: string;
  username: string;
}

export interface RegistryRequestAuthorization {
  credential: RegistryCredentialPayload;
  repository: string | null;
}
