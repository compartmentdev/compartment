import { describe, expect, it, vi, type Mock } from 'vitest';
import type { ApiConfig } from '../src/config';
import type { GitProviderRegistrationRow } from '../src/queries/git-provider-registration.query.types';
import type { Actor } from '../src/services/auth-actor.types';
import type * as VariablesCrypto from '../src/lib/variables-crypto';
import type * as GitSourceBootstrapRead from '../src/services/git-source/git-source-bootstrap.read';
import {
  requireGitHubRegistrationAccess,
  type GitHubRegistrationAccess,
} from '../src/services/git-source/git-source-descriptor-registration-access.service';

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

    const access: GitHubRegistrationAccess = await requireGitHubRegistrationAccess({
      actor: createActor('prn_followup_admin'),
      organizationId: 'org_123',
      providerHost: 'github.enterprise.example',
      registrationId: 'gpr_123',
      repositoryOwner: 'acme',
    });

    expect(access.privateKeyPem).toBe('private-key');
    expect(access.registration.id).toBe('gpr_123');
  });

  it('rejects registrations that do not match the requested provider host or owner', async (): Promise<void> => {
    mocks.requireGitProviderRegistration.mockResolvedValueOnce(createRegistration());

    await expect(
      requireGitHubRegistrationAccess({
        actor: createActor('prn_followup_admin'),
        organizationId: 'org_123',
        providerHost: 'github.com',
        registrationId: 'gpr_123',
        repositoryOwner: 'acme',
      }),
    ).rejects.toMatchObject({
      code: 'git_source_request_invalid',
    });
  });

  it('matches repository owner case-insensitively after GitHub verifies the installation account', async (): Promise<void> => {
    mocks.requireGitProviderRegistration.mockResolvedValueOnce(createRegistration({ repositoryOwner: 'ACME' }));
    mocks.decryptVariableValueFromStorage.mockReturnValueOnce('private-key');

    const access: GitHubRegistrationAccess = await requireGitHubRegistrationAccess({
      actor: createActor('prn_followup_admin'),
      organizationId: 'org_123',
      providerHost: 'github.enterprise.example',
      registrationId: 'gpr_123',
      repositoryOwner: 'acme',
    });

    expect(access.privateKeyPem).toBe('private-key');
  });

  it('rejects pending registrations before reading private key material', async (): Promise<void> => {
    mocks.requireGitProviderRegistration.mockResolvedValueOnce(createRegistration({ status: 'pending' }));

    await expect(
      requireGitHubRegistrationAccess({
        actor: createActor('prn_followup_admin'),
        organizationId: 'org_123',
        providerHost: 'github.enterprise.example',
        registrationId: 'gpr_123',
        repositoryOwner: 'acme',
      }),
    ).rejects.toMatchObject({
      code: 'git_source_registration_pending',
    });
    expect(mocks.decryptVariableValueFromStorage).not.toHaveBeenCalled();
  });

  it('rejects active registrations missing installation metadata before reading private key material', async (): Promise<void> => {
    mocks.requireGitProviderRegistration.mockResolvedValueOnce(createRegistration({ installationId: null }));

    await expect(
      requireGitHubRegistrationAccess({
        actor: createActor('prn_followup_admin'),
        organizationId: 'org_123',
        providerHost: 'github.enterprise.example',
        registrationId: 'gpr_123',
        repositoryOwner: 'acme',
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
