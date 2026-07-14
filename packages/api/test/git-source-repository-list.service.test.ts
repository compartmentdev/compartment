import { describe, expect, it, vi, type Mock } from 'vitest';
import type { GitProviderRegistrationRepositoryListResponse } from '@compartment/contracts';
import type { Actor } from '../src/services/auth-actor.types';
import type { GitProviderRegistrationRow } from '../src/queries/git-provider-registration.query.types';
import type * as GithubAppClientAdapter from '../src/services/git-source/github-app-client.adapter';
import type { GitHubInstallationRepository } from '../src/services/git-source/github-app-client.adapter.types';
import type * as GitSourceDescriptorRegistrationAccess from '../src/services/git-source/git-source-descriptor-registration-access.service';
import type { GitProviderAccess } from '../src/services/git-source/git-source-provider.types';
import { listGitProviderRegistrationRepositories } from '../src/services/git-source/git-source-repository-list.service';
import type * as OutboundHttpService from '../src/services/outbound-http.service';

type ListGitHubInstallationRepositoriesFromGitHub = typeof GithubAppClientAdapter.listGitHubInstallationRepositories;
type RequireGitProviderRegistrationAccess =
  typeof GitSourceDescriptorRegistrationAccess.requireGitProviderRegistrationAccess;

interface GithubAppClientAdapterModule {
  listGitHubInstallationRepositories: Mock<ListGitHubInstallationRepositoriesFromGitHub>;
}

interface GitSourceDescriptorRegistrationAccessModule {
  requireGitProviderRegistrationAccess: Mock<RequireGitProviderRegistrationAccess>;
}

interface OutboundHttpServiceModule {
  createGitLabTrustedOutboundFetch: Mock<CreateGitLabTrustedOutboundFetch>;
}

interface TestListGitProviderRegistrationRepositoriesInput {
  actor: Actor;
  organizationId: string;
  registrationId: string;
}

const mocks: {
  listGitHubInstallationRepositories: Mock<ListGitHubInstallationRepositoriesFromGitHub>;
  requireGitProviderRegistrationAccess: Mock<RequireGitProviderRegistrationAccess>;
  createGitLabTrustedOutboundFetch: Mock<CreateGitLabTrustedOutboundFetch>;
} = vi.hoisted(
  (): {
    listGitHubInstallationRepositories: Mock<ListGitHubInstallationRepositoriesFromGitHub>;
    requireGitProviderRegistrationAccess: Mock<RequireGitProviderRegistrationAccess>;
    createGitLabTrustedOutboundFetch: Mock<CreateGitLabTrustedOutboundFetch>;
  } => ({
    listGitHubInstallationRepositories: vi.fn<ListGitHubInstallationRepositoriesFromGitHub>(),
    requireGitProviderRegistrationAccess: vi.fn<RequireGitProviderRegistrationAccess>(),
    createGitLabTrustedOutboundFetch: vi.fn<CreateGitLabTrustedOutboundFetch>(),
  }),
);

vi.mock(
  '../src/services/outbound-http.service',
  (): OutboundHttpServiceModule => ({
    createGitLabTrustedOutboundFetch: mocks.createGitLabTrustedOutboundFetch,
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
    requireGitProviderRegistrationAccess: mocks.requireGitProviderRegistrationAccess,
  }),
);

describe('git source repository list service', (): void => {
  it('returns repositories when the provider can list the registration', async (): Promise<void> => {
    prepareRepositoryListMocks();
    mocks.listGitHubInstallationRepositories.mockResolvedValueOnce([createRepository()]);

    const response: GitProviderRegistrationRepositoryListResponse =
      await listGitProviderRegistrationRepositories(createListInput());

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
    });
  });

  it('surfaces not-found as a provider-neutral access error', async (): Promise<void> => {
    prepareRepositoryListMocks();
    mocks.listGitHubInstallationRepositories.mockRejectedValueOnce(createGitHubRequestFailure(404));

    await expect(listGitProviderRegistrationRepositories(createListInput())).rejects.toMatchObject({
      code: 'git_source_repository_access_denied',
    });
  });

  it('surfaces access denial through the same neutral error', async (): Promise<void> => {
    prepareRepositoryListMocks();
    mocks.listGitHubInstallationRepositories.mockRejectedValueOnce(createGitHubRequestFailure(403));

    await expect(listGitProviderRegistrationRepositories(createListInput())).rejects.toMatchObject({
      code: 'git_source_repository_access_denied',
    });
  });

  it('classifies a revoked GitLab token on repository listing as token invalid', async (): Promise<void> => {
    vi.resetAllMocks();
    mocks.requireGitProviderRegistrationAccess.mockResolvedValue(createGitLabProviderAccess());
    mocks.createGitLabTrustedOutboundFetch.mockReturnValue(
      vi.fn<typeof fetch>().mockResolvedValue(new Response('revoked', { status: 401 })),
    );

    await expect(listGitProviderRegistrationRepositories(createListInput())).rejects.toMatchObject({
      code: 'gitlab_token_invalid',
    });
  });
});

function prepareRepositoryListMocks(): void {
  vi.resetAllMocks();
  mocks.requireGitProviderRegistrationAccess.mockResolvedValue(createProviderAccess());
}

function createProviderAccess(): GitProviderAccess {
  return {
    credential: {
      kind: 'github_app',
      privateKeyPem: 'private-key',
    },
    registration: createRegistration(),
  };
}

function createGitLabProviderAccess(): GitProviderAccess {
  return {
    credential: { kind: 'gitlab_token', token: 'revoked-token' },
    registration: {
      ...createRegistration(),
      providerHost: 'gitlab.example.com',
      providerType: 'gitlab',
    },
  };
}

function createListInput(): TestListGitProviderRegistrationRepositoriesInput {
  return {
    actor: createActor(),
    organizationId: 'org_123',
    registrationId: 'gpr_123',
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
type CreateGitLabTrustedOutboundFetch = typeof OutboundHttpService.createGitLabTrustedOutboundFetch;
