import type {
  CreateGitDescriptorPullRequestRequest,
  GitDescriptorCandidate,
  GitDescriptorDraftFile,
  GitDescriptorPlanRequest,
  GitDescriptorPullRequestResponse,
} from '@compartment/contracts';
import { describe, expect, it, vi, type Mock } from 'vitest';
import type { ApiConfig } from '../src/config';
import { buildDescriptorCandidates } from '../src/services/git-source/git-source-descriptor-candidate.service';
import type { Actor } from '../src/services/auth-actor.types';
import type { GitProviderRegistrationRow } from '../src/queries/git-provider-registration.query.types';
import type * as GithubAppClientAdapter from '../src/services/git-source/github-app-client.adapter';
import type * as GitSourceDescriptorGithubOperation from '../src/services/git-source/git-source-descriptor-github-operation.service';
import type * as GitSourceDescriptorRegistrationAccess from '../src/services/git-source/git-source-descriptor-registration-access.service';
import type { GitHubRepositoryTreeEntry } from '../src/services/git-source/github-app-client.adapter.types';
import {
  createGitDescriptorPullRequest,
  readGitDescriptorPlan,
  readGitDescriptorPullRequestStatus,
} from '../src/services/git-source/git-source-descriptor.service';

type ReadGitHubRepositoryTree = typeof GithubAppClientAdapter.readGitHubRepositoryTree;
type ReadGitHubRepositoryContent = typeof GithubAppClientAdapter.readGitHubRepositoryContent;
type ListGitHubInstallationRepositories = typeof GithubAppClientAdapter.listGitHubInstallationRepositories;
type CreateDescriptorPullRequest = typeof GitSourceDescriptorGithubOperation.createDescriptorPullRequest;
type ReadDescriptorPullRequestStatus = typeof GitSourceDescriptorGithubOperation.readDescriptorPullRequestStatus;
type RequireGitHubRegistrationAccess = typeof GitSourceDescriptorRegistrationAccess.requireGitHubRegistrationAccess;
type BuildGitHubRegistrationClientAuth = typeof GitSourceDescriptorRegistrationAccess.buildGitHubRegistrationClientAuth;

interface RuntimeAccessModule {
  getApiConfig: () => Pick<ApiConfig, 'sessionSecret'>;
}

interface GithubAppClientAdapterModule {
  listGitHubInstallationRepositories: Mock<ListGitHubInstallationRepositories>;
  readGitHubRepositoryContent: Mock<ReadGitHubRepositoryContent>;
  readGitHubRepositoryTree: Mock<ReadGitHubRepositoryTree>;
}

interface GitSourceDescriptorGithubOperationModule {
  createDescriptorPullRequest: Mock<CreateDescriptorPullRequest>;
  readDescriptorPullRequestStatus: Mock<ReadDescriptorPullRequestStatus>;
}

interface GitSourceDescriptorRegistrationAccessModule {
  buildGitHubRegistrationClientAuth: Mock<BuildGitHubRegistrationClientAuth>;
  requireGitHubRegistrationAccess: Mock<RequireGitHubRegistrationAccess>;
}

const mocks: {
  buildGitHubRegistrationClientAuth: Mock<BuildGitHubRegistrationClientAuth>;
  createDescriptorPullRequest: Mock<CreateDescriptorPullRequest>;
  listGitHubInstallationRepositories: Mock<ListGitHubInstallationRepositories>;
  readGitHubRepositoryContent: Mock<ReadGitHubRepositoryContent>;
  readDescriptorPullRequestStatus: Mock<ReadDescriptorPullRequestStatus>;
  readGitHubRepositoryTree: Mock<ReadGitHubRepositoryTree>;
  requireGitHubRegistrationAccess: Mock<RequireGitHubRegistrationAccess>;
} = vi.hoisted(
  (): {
    buildGitHubRegistrationClientAuth: Mock<BuildGitHubRegistrationClientAuth>;
    createDescriptorPullRequest: Mock<CreateDescriptorPullRequest>;
    listGitHubInstallationRepositories: Mock<ListGitHubInstallationRepositories>;
    readGitHubRepositoryContent: Mock<ReadGitHubRepositoryContent>;
    readDescriptorPullRequestStatus: Mock<ReadDescriptorPullRequestStatus>;
    readGitHubRepositoryTree: Mock<ReadGitHubRepositoryTree>;
    requireGitHubRegistrationAccess: Mock<RequireGitHubRegistrationAccess>;
  } => ({
    buildGitHubRegistrationClientAuth: vi.fn<BuildGitHubRegistrationClientAuth>(),
    createDescriptorPullRequest: vi.fn<CreateDescriptorPullRequest>(),
    listGitHubInstallationRepositories: vi.fn<ListGitHubInstallationRepositories>(),
    readGitHubRepositoryContent: vi.fn<ReadGitHubRepositoryContent>(),
    readDescriptorPullRequestStatus: vi.fn<ReadDescriptorPullRequestStatus>(),
    readGitHubRepositoryTree: vi.fn<ReadGitHubRepositoryTree>(),
    requireGitHubRegistrationAccess: vi.fn<RequireGitHubRegistrationAccess>(),
  }),
);

vi.mock(
  '../src/runtime/runtime-access',
  (): RuntimeAccessModule => ({
    getApiConfig: (): Pick<ApiConfig, 'sessionSecret'> => ({
      sessionSecret: 'test-session-secret',
    }),
  }),
);

vi.mock(
  '../src/services/git-source/github-app-client.adapter',
  (): GithubAppClientAdapterModule => ({
    listGitHubInstallationRepositories: mocks.listGitHubInstallationRepositories,
    readGitHubRepositoryContent: mocks.readGitHubRepositoryContent,
    readGitHubRepositoryTree: mocks.readGitHubRepositoryTree,
  }),
);

vi.mock(
  '../src/services/git-source/git-source-descriptor-github-operation.service',
  async (): Promise<GitSourceDescriptorGithubOperationModule> => {
    const actual: typeof GitSourceDescriptorGithubOperation = await vi.importActual(
      '../src/services/git-source/git-source-descriptor-github-operation.service',
    );

    return {
      ...actual,
      createDescriptorPullRequest: mocks.createDescriptorPullRequest,
      readDescriptorPullRequestStatus: mocks.readDescriptorPullRequestStatus,
    };
  },
);

vi.mock(
  '../src/services/git-source/git-source-descriptor-registration-access.service',
  (): GitSourceDescriptorRegistrationAccessModule => ({
    buildGitHubRegistrationClientAuth: mocks.buildGitHubRegistrationClientAuth,
    requireGitHubRegistrationAccess: mocks.requireGitHubRegistrationAccess,
  }),
);

describe('git source descriptor service', (): void => {
  it('maps empty repositories to a typed descriptor plan error', async (): Promise<void> => {
    prepareDescriptorServiceMocks([]);
    mocks.readGitHubRepositoryTree.mockRejectedValueOnce(createGitHubEmptyRepositoryFailure());

    await expect(
      readGitDescriptorPlan({
        actor: createActor(),
        organizationId: 'org_123',
        request: createPlanRequest(),
      }),
    ).rejects.toMatchObject({
      code: 'git_source_repository_empty',
      message: 'The selected repository is empty. Add at least one commit to it, then try again.',
    });
  });

  it('creates a descriptor PR only for a server-computed descriptor candidate', async (): Promise<void> => {
    prepareDescriptorServiceMocks([blob('package.json')]);

    const request: CreateGitDescriptorPullRequestRequest = createPullRequestRequest(
      buildDescriptorCandidates('mono', [blob('package.json')])[0]!,
    );
    const response: GitDescriptorPullRequestResponse = await createGitDescriptorPullRequest({
      actor: createActor(),
      organizationId: 'org_123',
      request,
    });

    expect(response.pullRequestNumber).toBe(17);
    expect(response.statusToken).toMatch(/^[^.]+\.[^.]+$/u);
    expect(mocks.createDescriptorPullRequest).toHaveBeenCalledWith(expect.objectContaining({ request }));
  });

  it('creates a starter-app PR only for a server-computed empty-repository candidate', async (): Promise<void> => {
    prepareDescriptorServiceMocks([blob('README.md')]);

    const request: CreateGitDescriptorPullRequestRequest = createPullRequestRequest(
      buildDescriptorCandidates('mono', [blob('README.md')])[0]!,
    );
    await createGitDescriptorPullRequest({
      actor: createActor(),
      organizationId: 'org_123',
      request,
    });

    expect(mocks.createDescriptorPullRequest).toHaveBeenCalledTimes(1);
    expect(
      mocks.createDescriptorPullRequest.mock.calls[0]?.[0].request.files.map(
        (file: GitDescriptorDraftFile): string => file.path,
      ),
    ).toEqual(['compartment.yml', 'apps/site/index.html']);
  });

  it('accepts starter-app PR files even when the client sends them in a different order', async (): Promise<void> => {
    prepareDescriptorServiceMocks([blob('README.md')]);

    const candidate: GitDescriptorCandidate = buildDescriptorCandidates('mono', [blob('README.md')])[0]!;
    const request: CreateGitDescriptorPullRequestRequest = {
      ...createPullRequestRequest(candidate),
      files: [...candidate.files].reverse(),
    };
    await createGitDescriptorPullRequest({
      actor: createActor(),
      organizationId: 'org_123',
      request,
    });

    expect(mocks.createDescriptorPullRequest).toHaveBeenCalledWith(expect.objectContaining({ request }));
  });

  it('rejects descriptor PR content that does not match the server-computed plan', async (): Promise<void> => {
    prepareDescriptorServiceMocks([blob('package.json')]);

    await expect(
      createGitDescriptorPullRequest({
        actor: createActor(),
        organizationId: 'org_123',
        request: {
          ...createPullRequestRequest(buildDescriptorCandidates('mono', [blob('package.json')])[0]!),
          files: [
            {
              content: 'name: injected\n',
              path: 'compartment.yml',
            },
          ],
        },
      }),
    ).rejects.toMatchObject({
      code: 'git_source_request_invalid',
    });
    expect(mocks.createDescriptorPullRequest).not.toHaveBeenCalled();
  });

  it('requires PR status requests to carry the status token returned by PR creation', async (): Promise<void> => {
    prepareDescriptorServiceMocks([blob('package.json')]);
    const created: GitDescriptorPullRequestResponse = await createGitDescriptorPullRequest({
      actor: createActor(),
      organizationId: 'org_123',
      request: createPullRequestRequest(buildDescriptorCandidates('mono', [blob('package.json')])[0]!),
    });

    await expect(
      readGitDescriptorPullRequestStatus({
        actor: createActor(),
        organizationId: 'org_123',
        request: {
          providerHost: 'github.enterprise.example',
          pullRequestNumber: 18,
          registrationId: 'gpr_123',
          repositoryName: 'mono',
          repositoryOwner: 'acme',
          statusToken: created.statusToken,
        },
      }),
    ).rejects.toMatchObject({
      code: 'git_source_request_invalid',
    });
    expect(mocks.readDescriptorPullRequestStatus).not.toHaveBeenCalled();
  });
});

function prepareDescriptorServiceMocks(tree: GitHubRepositoryTreeEntry[]): void {
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
  mocks.readGitHubRepositoryTree.mockResolvedValue(tree);
  mocks.createDescriptorPullRequest.mockResolvedValue({
    htmlUrl: 'https://github.enterprise.example/acme/mono/pull/17',
    number: 17,
    state: 'open',
  });
}

function createPullRequestRequest(candidate: GitDescriptorCandidate): CreateGitDescriptorPullRequestRequest {
  return {
    appFolder: candidate.appFolder,
    branchName: 'main',
    descriptorPath: candidate.descriptorPath,
    files: candidate.files,
    projectName: candidate.projectName,
    providerHost: 'github.enterprise.example',
    registrationId: 'gpr_123',
    repositoryName: 'mono',
    repositoryOwner: 'acme',
  };
}

function createPlanRequest(): GitDescriptorPlanRequest {
  return {
    branchName: 'main',
    providerHost: 'github.enterprise.example',
    registrationId: 'gpr_123',
    repositoryName: 'mono',
    repositoryOwner: 'acme',
  };
}

function blob(path: string): GitHubRepositoryTreeEntry {
  return {
    path,
    type: 'blob',
  };
}

function createGitHubEmptyRepositoryFailure(): Error {
  return Object.assign(new Error('Git Repository is empty'), {
    response: {
      data: {
        message: 'Git Repository is empty',
      },
    },
    status: 409,
  });
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
