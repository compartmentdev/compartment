import { describe, expect, it, vi, type Mock } from 'vitest';
import type { ApiConfig } from '../src/config';
import type { GitProviderRegistrationRow } from '../src/queries/git-provider-registration.query.types';
import type { Actor } from '../src/services/auth-actor.types';
import type * as VariablesCrypto from '../src/lib/variables-crypto';
import type * as GitSourceBootstrapRead from '../src/services/git-source/git-source-bootstrap.read';
import { requireGitProviderRegistrationAccess } from '../src/services/git-source/git-source-descriptor-registration-access.service';
import type { GitProviderAccess } from '../src/services/git-source/git-source-provider.types';

type RequireGitProviderRegistration = typeof GitSourceBootstrapRead.requireGitProviderRegistration;
type DecryptVariableValueFromStorage = typeof VariablesCrypto.decryptVariableValueFromStorage;

interface GitSourceBootstrapReadModule {
  requireGitProviderRegistration: Mock<RequireGitProviderRegistration>;
}

interface VariablesCryptoModule {
  decryptVariableValueFromStorage: Mock<DecryptVariableValueFromStorage>;
}

interface RuntimeAccessModule {
  getApiConfig: () => Pick<ApiConfig, 'variablesMasterKey'>;
}

const mocks: {
  decryptVariableValueFromStorage: Mock<DecryptVariableValueFromStorage>;
  requireGitProviderRegistration: Mock<RequireGitProviderRegistration>;
} = vi.hoisted(
  (): {
    decryptVariableValueFromStorage: Mock<DecryptVariableValueFromStorage>;
    requireGitProviderRegistration: Mock<RequireGitProviderRegistration>;
  } => ({
    decryptVariableValueFromStorage: vi.fn<DecryptVariableValueFromStorage>(),
    requireGitProviderRegistration: vi.fn<RequireGitProviderRegistration>(),
  }),
);

vi.mock(
  '../src/services/git-source/git-source-bootstrap.read',
  (): GitSourceBootstrapReadModule => ({
    requireGitProviderRegistration: mocks.requireGitProviderRegistration,
  }),
);

vi.mock(
  '../src/lib/variables-crypto',
  (): VariablesCryptoModule => ({
    decryptVariableValueFromStorage: mocks.decryptVariableValueFromStorage,
  }),
);

vi.mock(
  '../src/runtime/runtime-access',
  (): RuntimeAccessModule => ({
    getApiConfig: (): Pick<ApiConfig, 'variablesMasterKey'> => ({
      variablesMasterKey: Buffer.from('11'.repeat(32), 'hex'),
    }),
  }),
);

describe('git source descriptor registration access', (): void => {
  it('allows a source manager to use an install-owned registration created by another principal', async (): Promise<void> => {
    mocks.requireGitProviderRegistration.mockResolvedValueOnce(
      createRegistration({ createdByPrincipalId: 'prn_original_admin' }),
    );
    mocks.decryptVariableValueFromStorage.mockReturnValueOnce('private-key');

    const access: GitProviderAccess = await requireGitProviderRegistrationAccess({
      actor: createActor('prn_followup_admin'),
      organizationId: 'org_123',
      registrationId: 'gpr_123',
    });

    expect(access.credential.privateKeyPem).toBe('private-key');
    expect(access.registration.id).toBe('gpr_123');
  });

  it('resolves provider material from the persisted registration', async (): Promise<void> => {
    mocks.requireGitProviderRegistration.mockResolvedValueOnce(createGitLabRegistration());
    mocks.decryptVariableValueFromStorage.mockReturnValueOnce('gitlab-token');
    const access: GitProviderAccess = await requireGitProviderRegistrationAccess({
      actor: createActor('prn_followup_admin'),
      organizationId: 'org_123',
      registrationId: 'gpr_123',
    });
    expect(access.credential).toEqual({ kind: 'gitlab_token', token: 'gitlab-token' });
  });

  it('rejects pending registrations before reading private key material', async (): Promise<void> => {
    mocks.requireGitProviderRegistration.mockResolvedValueOnce(createRegistration({ status: 'pending' }));

    await expect(
      requireGitProviderRegistrationAccess({
        actor: createActor('prn_followup_admin'),
        organizationId: 'org_123',
        registrationId: 'gpr_123',
      }),
    ).rejects.toMatchObject({
      code: 'git_source_registration_pending',
    });
    expect(mocks.decryptVariableValueFromStorage).not.toHaveBeenCalled();
  });

  it('rejects active registrations missing credential material', async (): Promise<void> => {
    mocks.requireGitProviderRegistration.mockResolvedValueOnce(createRegistration({ privateKeyPemCiphertext: null }));

    await expect(
      requireGitProviderRegistrationAccess({
        actor: createActor('prn_followup_admin'),
        organizationId: 'org_123',
        registrationId: 'gpr_123',
      }),
    ).rejects.toMatchObject({
      code: 'git_source_registration_failed',
    });
    expect(mocks.decryptVariableValueFromStorage).not.toHaveBeenCalled();
  });
});

function createActor(principalId: string): Actor {
  return {
    authSession: {
      authMethodKind: 'password',
      oidcProviderId: null,
      organizationId: null,
      principalId,
    },
    principalEmail: `${principalId}@example.com`,
    principalId,
    principalType: 'user',
    sessionId: `ses_${principalId}`,
    tokenHash: `hash_${principalId}`,
  };
}

function createRegistration(overrides: Partial<GitProviderRegistrationRow> = {}): GitProviderRegistrationRow {
  return {
    accessTokenCiphertext: null,
    accessTokenEncryptionKeyId: null,
    accessTokenExpiresAt: null,
    providerAccountId: null,
    providerAccountLogin: null,
    appId: '12345',
    appName: 'Compartment',
    appSlug: 'compartment',
    appUrl: 'https://github.enterprise.example/apps/compartment',
    bootstrapStateId: null,
    callbackUrl: 'https://console.example/v1/sources/git/providers/github/callback',
    createdAt: new Date('2026-05-01T00:00:00.000Z'),
    createdByPrincipalId: 'prn_original_admin',
    id: 'gpr_123',
    organizationId: 'org_123',
    installationAccountLogin: 'acme',
    installationAccountType: 'Organization',
    installationId: '98765',
    pendingExpiresAt: null,
    privateKeyPemCiphertext: 'private-key-ciphertext',
    privateKeyPemEncryptionKeyId: 'private-key-id',
    providerHost: 'github.enterprise.example',
    providerType: 'github_app',
    repositoryOwner: 'acme',
    status: 'active',
    updatedAt: new Date('2026-05-01T00:00:00.000Z'),
    webhookSecretCiphertext: 'webhook-secret-ciphertext',
    webhookSecretEncryptionKeyId: 'webhook-secret-id',
    webhookUrl: 'https://console.example/v1/sources/git/providers/github/registrations/gpr_123/webhook',
    ...overrides,
  };
}

function createGitLabRegistration(overrides: Partial<GitProviderRegistrationRow> = {}): GitProviderRegistrationRow {
  return createRegistration({
    accessTokenCiphertext: 'encrypted-token',
    accessTokenEncryptionKeyId: 'token-key',
    accessTokenExpiresAt: null,
    providerAccountId: null,
    providerAccountLogin: null,
    installationId: null,
    privateKeyPemCiphertext: null,
    privateKeyPemEncryptionKeyId: null,
    providerHost: 'gitlab.com',
    providerType: 'gitlab',
    repositoryOwner: 'token-holder',
    ...overrides,
  });
}
