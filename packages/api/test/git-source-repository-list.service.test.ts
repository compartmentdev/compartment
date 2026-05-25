import { describe, expect, it, vi, type Mock } from 'vitest';
import type { GitHubInstallationRepositoryListResponse } from '@compartment/contracts';
import type { Actor } from '../src/services/auth-actor.types';
import type { GitProviderRegistrationRow } from '../src/queries/git-provider-registration.query.types';
import type * as GithubAppClientAdapter from '../src/services/git-source/github-app-client.adapter';
import type { GitHubInstallationRepository } from '../src/services/git-source/github-app-client.adapter.types';
import type * as GitSourceDescriptorRegistrationAccess from '../src/services/git-source/git-source-descriptor-registration-access.service';
import {
  listGitHubInstallationRepositories,
  type ListGitHubInstallationRepositoriesInput,
} from '../src/services/git-source/git-source-repository-list.service';

type ListGitHubInstallationRepositoriesFromGitHub = typeof GithubAppClientAdapter.listGitHubInstallationRepositories;
type RequireGitHubRegistrationAccess = typeof GitSourceDescriptorRegistrationAccess.requireGitHubRegistrationAccess;
type BuildGitHubRegistrationClientAuth = typeof GitSourceDescriptorRegistrationAccess.buildGitHubRegistrationClientAuth;

interface GithubAppClientAdapterModule {
  listGitHubInstallationRepositories: Mock<ListGitHubInstallationRepositoriesFromGitHub>;
}

interface GitSourceDescriptorRegistrationAccessModule {
  buildGitHubRegistrationClientAuth: Mock<BuildGitHubRegistrationClientAuth>;
  requireGitHubRegistrationAccess: Mock<RequireGitHubRegistrationAccess>;
}

const mocks: {
  buildGitHubRegistrationClientAuth: Mock<BuildGitHubRegistrationClientAuth>;
  listGitHubInstallationRepositories: Mock<ListGitHubInstallationRepositoriesFromGitHub>;
  requireGitHubRegistrationAccess: Mock<RequireGitHubRegistrationAccess>;
} = vi.hoisted(
  (): {
    buildGitHubRegistrationClientAuth: Mock<BuildGitHubRegistrationClientAuth>;
    listGitHubInstallationRepositories: Mock<ListGitHubInstallationRepositoriesFromGitHub>;
    requireGitHubRegistrationAccess: Mock<RequireGitHubRegistrationAccess>;
  } => ({
    buildGitHubRegistrationClientAuth: vi.fn<BuildGitHubRegistrationClientAuth>(),
    listGitHubInstallationRepositories: vi.fn<ListGitHubInstallationRepositoriesFromGitHub>(),
    requireGitHubRegistrationAccess: vi.fn<RequireGitHubRegistrationAccess>(),
  }),
);

vi.mock(
  '../src/services/git-source/github-app-client.adapter',
  (): GithubAppClientAdapterModule => ({
    listGitHubInstallationRepositories: mocks.listGitHubInstallationRepositories,
  }),
);

vi.mock(
  '../src/services/git-source/git-source-descriptor-registration-access.service',
  (): GitSourceDescriptorRegistrationAccessModule => ({
    buildGitHubRegistrationClientAuth: mocks.buildGitHubRegistrationClientAuth,
    requireGitHubRegistrationAccess: mocks.requireGitHubRegistrationAccess,
  }),
);

describe('git source repository list service', (): void => {
  it('returns ready repositories when GitHub can list the installation', async (): Promise<void> => {
    prepareRepositoryListMocks();
    mocks.listGitHubInstallationRepositories.mockResolvedValueOnce([createRepository()]);

    const response: GitHubInstallationRepositoryListResponse =
      await listGitHubInstallationRepositories(createListInput());

    expect(response).toEqual({
      repositories: [
        {
          defaultBranchName: 'main',
          fullName: 'acme/mono',
          id: '12345',
          name: 'mono',
          owner: 'acme',
          private: true,
        },
      ],
      status: 'ready',
    });
  });

  it('returns bootstrap required when the persisted installation cannot list repositories', async (): Promise<void> => {
    prepareRepositoryListMocks();
    mocks.listGitHubInstallationRepositories.mockRejectedValueOnce(createGitHubRequestFailure(404));

    const response: GitHubInstallationRepositoryListResponse =
      await listGitHubInstallationRepositories(createListInput());

    expect(response).toEqual({
      repositories: [],
      status: 'provider_bootstrap_required',
    });
  });

  it('returns bootstrap required for repository access denial without mutating bootstrap state', async (): Promise<void> => {
    prepareRepositoryListMocks();
    mocks.listGitHubInstallationRepositories.mockRejectedValueOnce(createGitHubRequestFailure(403));

    await expect(listGitHubInstallationRepositories(createListInput())).resolves.toEqual({
      repositories: [],
      status: 'provider_bootstrap_required',
    });
  });
});

function prepareRepositoryListMocks(): void {
  vi.resetAllMocks();
  mocks.requireGitHubRegistrationAccess.mockResolvedValue({
    privateKeyPem: 'private-key',
    registration: createRegistration(),
  });
  mocks.buildGitHubRegistrationClientAuth.mockReturnValue({
    appId: '12345',
    installationId: '98765',
    privateKeyPem: 'private-key',
    providerHost: 'github.enterprise.example',
  });
}

function createListInput(): ListGitHubInstallationRepositoriesInput {
  return {
    actor: createActor(),
    organizationId: 'org_123',
    providerHost: 'github.enterprise.example',
    registrationId: 'gpr_123',
    repositoryOwner: 'acme',
  };
}

function createGitHubRequestFailure(status: number): Error {
  return Object.assign(new Error('GitHub request failed.'), { status });
}

function createRepository(): GitHubInstallationRepository {
  return {
    defaultBranchName: 'main',
    fullName: 'acme/mono',
    private: true,
    repositoryExternalId: '12345',
    repositoryName: 'mono',
    repositoryOwner: 'acme',
  };
}

function createActor(): Actor {
  return {
    authSession: {
      authMethodKind: 'password',
      oidcProviderId: null,
      organizationId: null,
      principalId: 'prn_admin',
    },
    principalEmail: 'admin@example.com',
    principalId: 'prn_admin',
    principalType: 'user',
    sessionId: 'ses_admin',
    tokenHash: 'hash_admin',
  };
}

function createRegistration(): GitProviderRegistrationRow {
  return {
    appId: '12345',
    appName: 'Compartment',
    appSlug: 'compartment',
    appUrl: 'https://github.enterprise.example/apps/compartment',
    bootstrapStateId: null,
    callbackUrl: 'https://console.example/v1/sources/git/providers/github/callback',
    createdAt: new Date('2026-05-01T00:00:00.000Z'),
    createdByPrincipalId: 'prn_admin',
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
  };
}
