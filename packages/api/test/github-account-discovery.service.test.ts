import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { findActiveGitProviderRegistrationsByRepositoryOwners } from '../src/queries/git-provider-registration-active-owners.query';
import type { GitProviderRegistrationRow } from '../src/queries/git-provider-registration.query.types';
import type {
  readGitHubAccountDiscoveryBrokerResult,
  startGitHubAccountDiscoveryBrokerSession,
} from '../src/services/git-source/github-account-discovery-broker.adapter';
import type { readActiveGitHubRegistrationState } from '../src/services/git-source/git-source-bootstrap-active-validation.service';
import type { requireGitProviderAccessByRegistrationId } from '../src/services/git-source/git-source-provider-access.service';
import type { GitProviderAccess } from '../src/services/git-source/git-source-provider.types';
import {
  readGitHubAccountDiscoveryResult,
  startGitHubAccountDiscovery,
} from '../src/services/git-source/github-account-discovery.service';

type StartGitHubAccountDiscoveryBrokerSession = typeof startGitHubAccountDiscoveryBrokerSession;
type ReadGitHubAccountDiscoveryBrokerResult = typeof readGitHubAccountDiscoveryBrokerResult;
type FindActiveGitProviderRegistrationsByRepositoryOwners = typeof findActiveGitProviderRegistrationsByRepositoryOwners;
type ReadActiveGitHubRegistrationState = typeof readActiveGitHubRegistrationState;
type RequireGitProviderAccessByRegistrationId = typeof requireGitProviderAccessByRegistrationId;

interface GitHubAccountDiscoveryBrokerAdapterModule {
  readGitHubAccountDiscoveryBrokerResult: Mock<ReadGitHubAccountDiscoveryBrokerResult>;
  startGitHubAccountDiscoveryBrokerSession: Mock<StartGitHubAccountDiscoveryBrokerSession>;
}

interface GitProviderRegistrationQueryModule {
  findActiveGitProviderRegistrationsByRepositoryOwners: Mock<FindActiveGitProviderRegistrationsByRepositoryOwners>;
}

interface GitSourceBootstrapActiveValidationServiceModule {
  readActiveGitHubRegistrationState: Mock<ReadActiveGitHubRegistrationState>;
}

interface GitSourceProviderAccessServiceModule {
  requireGitProviderAccessByRegistrationId: Mock<RequireGitProviderAccessByRegistrationId>;
}

interface RuntimeAccessModule {
  getApiConfig: () => object;
}

interface TestRuntimePublicSettings {
  baseDomain: string;
  compartmentUrl: string;
}

interface PublicHostsServiceModule {
  buildRuntimePublicSettings: () => TestRuntimePublicSettings;
}

const mocks: {
  findActiveGitProviderRegistrationsByRepositoryOwners: Mock<FindActiveGitProviderRegistrationsByRepositoryOwners>;
  readActiveGitHubRegistrationState: Mock<ReadActiveGitHubRegistrationState>;
  requireGitProviderAccessByRegistrationId: Mock<RequireGitProviderAccessByRegistrationId>;
  readGitHubAccountDiscoveryBrokerResult: Mock<ReadGitHubAccountDiscoveryBrokerResult>;
  startGitHubAccountDiscoveryBrokerSession: Mock<StartGitHubAccountDiscoveryBrokerSession>;
} = vi.hoisted(
  (): {
    findActiveGitProviderRegistrationsByRepositoryOwners: Mock<FindActiveGitProviderRegistrationsByRepositoryOwners>;
    readActiveGitHubRegistrationState: Mock<ReadActiveGitHubRegistrationState>;
    requireGitProviderAccessByRegistrationId: Mock<RequireGitProviderAccessByRegistrationId>;
    readGitHubAccountDiscoveryBrokerResult: Mock<ReadGitHubAccountDiscoveryBrokerResult>;
    startGitHubAccountDiscoveryBrokerSession: Mock<StartGitHubAccountDiscoveryBrokerSession>;
  } => ({
    findActiveGitProviderRegistrationsByRepositoryOwners: vi.fn<FindActiveGitProviderRegistrationsByRepositoryOwners>(),
    readActiveGitHubRegistrationState: vi.fn<ReadActiveGitHubRegistrationState>(),
    requireGitProviderAccessByRegistrationId: vi.fn<RequireGitProviderAccessByRegistrationId>(),
    readGitHubAccountDiscoveryBrokerResult: vi.fn<ReadGitHubAccountDiscoveryBrokerResult>(),
    startGitHubAccountDiscoveryBrokerSession: vi.fn<StartGitHubAccountDiscoveryBrokerSession>(),
  }),
);

vi.mock(
  '../src/services/git-source/github-account-discovery-broker.adapter',
  (): GitHubAccountDiscoveryBrokerAdapterModule => ({
    readGitHubAccountDiscoveryBrokerResult: mocks.readGitHubAccountDiscoveryBrokerResult,
    startGitHubAccountDiscoveryBrokerSession: mocks.startGitHubAccountDiscoveryBrokerSession,
  }),
);

vi.mock(
  '../src/services/git-source/git-source-provider-access.service',
  (): GitSourceProviderAccessServiceModule => ({
    requireGitProviderAccessByRegistrationId: mocks.requireGitProviderAccessByRegistrationId,
  }),
);

vi.mock(
  '../src/queries/git-provider-registration-active-owners.query',
  (): GitProviderRegistrationQueryModule => ({
    findActiveGitProviderRegistrationsByRepositoryOwners: mocks.findActiveGitProviderRegistrationsByRepositoryOwners,
  }),
);

vi.mock(
  '../src/services/git-source/git-source-bootstrap-active-validation.service',
  (): GitSourceBootstrapActiveValidationServiceModule => ({
    readActiveGitHubRegistrationState: mocks.readActiveGitHubRegistrationState,
  }),
);

vi.mock(
  '../src/runtime/runtime-access',
  (): RuntimeAccessModule => ({
    getApiConfig: (): object => ({}),
  }),
);

vi.mock(
  '../src/services/public-hosts.service',
  (): PublicHostsServiceModule => ({
    buildRuntimePublicSettings: (): TestRuntimePublicSettings => ({
      baseDomain: 'example.com',
      compartmentUrl: 'https://console.example.com',
    }),
  }),
);

describe('GitHub account discovery service', (): void => {
  beforeEach((): void => {
    mocks.requireGitProviderAccessByRegistrationId.mockImplementation(
      async (_organizationId: string, registrationId: string): Promise<GitProviderAccess> =>
        await Promise.resolve({
          credential: {
            appId: 'app_123',
            appName: 'Compartment',
            appSlug: 'compartment',
            appUrl: 'https://github.com/apps/compartment',
            installationAccountLogin: 'acme',
            installationAccountType: 'Organization',
            installationId: 'ins_123',
            kind: 'github_app',
            privateKeyPem: 'private-key',
          },
          registration: createGitProviderRegistrationRow(registrationId),
        }),
    );
  });

  afterEach((): void => {
    vi.resetAllMocks();
  });

  it('rejects broker discovery return URLs outside this install origin', async (): Promise<void> => {
    await expect(
      startGitHubAccountDiscovery({
        returnTo: 'https://evil.example.com/sources/git/setup',
      }),
    ).rejects.toMatchObject({
      code: 'git_source_registration_failed',
    });

    expect(mocks.startGitHubAccountDiscoveryBrokerSession).not.toHaveBeenCalled();
  });

  it('annotates discovered accounts with install status from active registrations', async (): Promise<void> => {
    mocks.readGitHubAccountDiscoveryBrokerResult.mockResolvedValueOnce({
      accounts: [
        {
          avatarUrl: null,
          login: 'acme',
          type: 'organization',
        },
        {
          avatarUrl: 'https://avatars.example/admin.png',
          login: 'admin',
          type: 'user',
        },
      ],
      user: {
        avatarUrl: 'https://avatars.example/admin.png',
        login: 'admin',
        type: 'user',
      },
    });
    mocks.findActiveGitProviderRegistrationsByRepositoryOwners.mockResolvedValueOnce([
      createGitProviderRegistrationRow('acme'),
    ]);
    mocks.readActiveGitHubRegistrationState.mockResolvedValueOnce('valid');

    await expect(
      readGitHubAccountDiscoveryResult({
        organizationId: 'org_123',
        providerHost: 'github.com',
        request: {
          resultToken: 'result_123',
          sessionId: 'gad_123',
        },
      }),
    ).resolves.toEqual({
      accounts: [
        {
          appInstallationStatus: 'installed',
          avatarUrl: null,
          login: 'acme',
          type: 'organization',
        },
        {
          appInstallationStatus: 'not_installed',
          avatarUrl: 'https://avatars.example/admin.png',
          login: 'admin',
          type: 'user',
        },
      ],
      user: {
        appInstallationStatus: 'not_installed',
        avatarUrl: 'https://avatars.example/admin.png',
        login: 'admin',
        type: 'user',
      },
    });

    expect(mocks.findActiveGitProviderRegistrationsByRepositoryOwners).toHaveBeenCalledWith({
      organizationId: 'org_123',
      providerHost: 'github.com',
      repositoryOwners: ['acme', 'admin', 'admin'],
    });
    expect(mocks.readActiveGitHubRegistrationState).toHaveBeenCalledTimes(1);
  });

  it('treats stale active registrations as not installed', async (): Promise<void> => {
    mocks.readGitHubAccountDiscoveryBrokerResult.mockResolvedValueOnce({
      accounts: [
        {
          avatarUrl: null,
          login: 'acme',
          type: 'organization',
        },
      ],
      user: {
        avatarUrl: 'https://avatars.example/admin.png',
        login: 'admin',
        type: 'user',
      },
    });
    mocks.findActiveGitProviderRegistrationsByRepositoryOwners.mockResolvedValueOnce([
      createGitProviderRegistrationRow('acme'),
    ]);
    mocks.readActiveGitHubRegistrationState.mockResolvedValueOnce('installation_missing');

    await expect(
      readGitHubAccountDiscoveryResult({
        organizationId: 'org_123',
        providerHost: 'github.com',
        request: {
          resultToken: 'result_123',
          sessionId: 'gad_123',
        },
      }),
    ).resolves.toEqual({
      accounts: [
        {
          appInstallationStatus: 'not_installed',
          avatarUrl: null,
          login: 'acme',
          type: 'organization',
        },
      ],
      user: {
        appInstallationStatus: 'not_installed',
        avatarUrl: 'https://avatars.example/admin.png',
        login: 'admin',
        type: 'user',
      },
    });
  });
});

function createGitProviderRegistrationRow(repositoryOwner: string): GitProviderRegistrationRow {
  return {
    providerAccountId: null,
    providerAccountLogin: null,
    bootstrapStateId: null,
    callbackUrl: 'https://console.example.com/v1/sources/git/providers/github/callback',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    createdByPrincipalId: 'prn_123',
    id: 'gpr_123',
    organizationId: 'org_123',
    pendingExpiresAt: null,
    providerHost: 'github.com',
    providerType: 'github',
    repositoryOwner,
    status: 'active',
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    webhookSecretCiphertext: 'ciphertext',
    webhookSecretEncryptionKeyId: 'key_123',
    webhookUrl: 'https://console.example.com/v1/sources/git/providers/github/webhook',
  };
}
