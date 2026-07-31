import type { CreateGitLabProviderRegistrationRequest } from '@compartment/contracts';

export interface CreateGitLabRegistrationInput {
  actorPrincipalId: string;
  organizationId: string;
  request: CreateGitLabProviderRegistrationRequest;
}

export interface GitLabRegistrationSecrets {
  accessTokenCiphertext: string;
  accessTokenEncryptionKeyId: string;
  webhookSecretCiphertext: string;
  webhookSecretEncryptionKeyId: string;
}

export interface GitLabRegistrationView {
  createdAt: string;
  expiresAt: string | null;
  providerAccountLogin: string;
  providerHost: string;
  providerType: 'gitlab';
  registrationId: string;
}
