import type { LightMyRequestResponse } from 'fastify';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import {
  gitDescriptorPlanResponseSchema,
  gitDescriptorPullRequestResponseSchema,
  gitDescriptorPullRequestStatusResponseSchema,
  gitHubAccountDiscoveryResultResponseSchema,
  gitHubAccountDiscoveryStartResponseSchema,
  gitHubInstallationRepositoryListResponseSchema,
  listCompartmentRolePermissions,
  type CreateGitDescriptorPullRequestRequest,
  type GitDescriptorPlanRequest,
  type GitDescriptorPlanResponse,
  type GitDescriptorPullRequestResponse,
  type GitDescriptorPullRequestStatusResponse,
  type GitHubAccountDiscoveryAccount,
  type GitHubAccountDiscoveryResultResponse,
  type GitHubAccountDiscoveryStartResponse,
  type GitHubInstallationRepositoryListResponse,
} from '@compartment/contracts';
import type { ApiApp } from '../src/app.types';
import { createGitSourceRepositoryEmptyError } from '../src/errors/api-business-error';
import type { Actor } from '../src/services/auth-actor.types';
import type { resolveInheritedAccess } from '../src/services/access-scope.service';
import type { authenticateSession } from '../src/services/authentication.service';
import type { resolveOrganizationForPrincipal } from '../src/services/organizations.service';
import type { isAuthSessionAllowedForOrganization } from '../src/services/organization-auth-settings.service';
import type {
  readGitHubAccountDiscoveryResult,
  startGitHubAccountDiscovery,
} from '../src/services/git-source/github-account-discovery.service';
import type {
  createGitDescriptorPullRequest,
  readGitDescriptorPlan,
  readGitDescriptorPullRequestStatus,
} from '../src/services/git-source/git-source-descriptor.service';
import type { listGitHubInstallationRepositories } from '../src/services/git-source/git-source-repository-list.service';
import { applyApiRouteTestEnv, expectJsonError, withApiRouteApp } from './api-route-test.harness';

type AuthenticateSession = typeof authenticateSession;
type ResolveInheritedAccess = typeof resolveInheritedAccess;
type ResolveOrganizationForPrincipal = typeof resolveOrganizationForPrincipal;
type IsAuthSessionAllowedForOrganization = typeof isAuthSessionAllowedForOrganization;
type StartGitHubAccountDiscovery = typeof startGitHubAccountDiscovery;
type ReadGitHubAccountDiscoveryResult = typeof readGitHubAccountDiscoveryResult;
type ListGitHubInstallationRepositories = typeof listGitHubInstallationRepositories;
type ReadGitDescriptorPlan = typeof readGitDescriptorPlan;
type CreateGitDescriptorPullRequest = typeof createGitDescriptorPullRequest;
type ReadGitDescriptorPullRequestStatus = typeof readGitDescriptorPullRequestStatus;

interface SourceGitDescriptorRouteMocks {
  authenticateSession: Mock<AuthenticateSession>;
  createGitDescriptorPullRequest: Mock<CreateGitDescriptorPullRequest>;
  isAuthSessionAllowedForOrganization: Mock<IsAuthSessionAllowedForOrganization>;
  listGitHubInstallationRepositories: Mock<ListGitHubInstallationRepositories>;
  readGitDescriptorPlan: Mock<ReadGitDescriptorPlan>;
  readGitDescriptorPullRequestStatus: Mock<ReadGitDescriptorPullRequestStatus>;
  readGitHubAccountDiscoveryResult: Mock<ReadGitHubAccountDiscoveryResult>;
  resolveInheritedAccess: Mock<ResolveInheritedAccess>;
  resolveOrganizationForPrincipal: Mock<ResolveOrganizationForPrincipal>;
  startGitHubAccountDiscovery: Mock<StartGitHubAccountDiscovery>;
}

interface AuthenticationServiceModule {
  authenticateSession: Mock<AuthenticateSession>;
}

interface AccessScopeServiceModule {
  resolveInheritedAccess: Mock<ResolveInheritedAccess>;
}

interface OrganizationsServiceModule {
  resolveOrganizationForPrincipal: Mock<ResolveOrganizationForPrincipal>;
}

interface OrganizationAuthSettingsServiceModule {
  isAuthSessionAllowedForOrganization: Mock<IsAuthSessionAllowedForOrganization>;
}

interface GitHubAccountDiscoveryServiceModule {
  readGitHubAccountDiscoveryResult: Mock<ReadGitHubAccountDiscoveryResult>;
  startGitHubAccountDiscovery: Mock<StartGitHubAccountDiscovery>;
}

interface GitSourceDescriptorServiceModule {
  createGitDescriptorPullRequest: Mock<CreateGitDescriptorPullRequest>;
  readGitDescriptorPlan: Mock<ReadGitDescriptorPlan>;
  readGitDescriptorPullRequestStatus: Mock<ReadGitDescriptorPullRequestStatus>;
}

const mocks: SourceGitDescriptorRouteMocks = vi.hoisted(
  (): SourceGitDescriptorRouteMocks => ({
    authenticateSession: vi.fn<AuthenticateSession>(),
    createGitDescriptorPullRequest: vi.fn<CreateGitDescriptorPullRequest>(),
    isAuthSessionAllowedForOrganization: vi.fn<IsAuthSessionAllowedForOrganization>(),
    listGitHubInstallationRepositories: vi.fn<ListGitHubInstallationRepositories>(),
    readGitDescriptorPlan: vi.fn<ReadGitDescriptorPlan>(),
    readGitDescriptorPullRequestStatus: vi.fn<ReadGitDescriptorPullRequestStatus>(),
    readGitHubAccountDiscoveryResult: vi.fn<ReadGitHubAccountDiscoveryResult>(),
    resolveInheritedAccess: vi.fn<ResolveInheritedAccess>(),
    resolveOrganizationForPrincipal: vi.fn<ResolveOrganizationForPrincipal>(),
    startGitHubAccountDiscovery: vi.fn<StartGitHubAccountDiscovery>(),
  }),
);

vi.mock(
  '../src/services/authentication.service',
  (): AuthenticationServiceModule => ({
    authenticateSession: mocks.authenticateSession,
  }),
);

vi.mock(
  '../src/services/access-scope.service',
  (): AccessScopeServiceModule => ({
    resolveInheritedAccess: mocks.resolveInheritedAccess,
  }),
);

vi.mock(
  '../src/services/organizations.service',
  (): OrganizationsServiceModule => ({
    resolveOrganizationForPrincipal: mocks.resolveOrganizationForPrincipal,
  }),
);

vi.mock(
  '../src/services/organization-auth-settings.service',
  (): OrganizationAuthSettingsServiceModule => ({
    isAuthSessionAllowedForOrganization: mocks.isAuthSessionAllowedForOrganization,
  }),
);

vi.mock(
  '../src/services/git-source/github-account-discovery.service',
  (): GitHubAccountDiscoveryServiceModule => ({
    readGitHubAccountDiscoveryResult: mocks.readGitHubAccountDiscoveryResult,
    startGitHubAccountDiscovery: mocks.startGitHubAccountDiscovery,
  }),
);

vi.mock(
  '../src/services/git-source/git-source-descriptor.service',
  (): GitSourceDescriptorServiceModule => ({
    createGitDescriptorPullRequest: mocks.createGitDescriptorPullRequest,
    readGitDescriptorPlan: mocks.readGitDescriptorPlan,
    readGitDescriptorPullRequestStatus: mocks.readGitDescriptorPullRequestStatus,
  }),
);

vi.mock(
  '../src/services/git-source/git-source-repository-list.service',
  (): { listGitHubInstallationRepositories: Mock<ListGitHubInstallationRepositories> } => ({
    listGitHubInstallationRepositories: mocks.listGitHubInstallationRepositories,
  }),
);

describe('git source descriptor and discovery routes', (): void => {
  afterEach((): void => {
    vi.resetAllMocks();
  });

  it('starts GitHub account discovery for an authenticated admin', async (): Promise<void> => {
    prepareAuthenticatedRoute('admin');
    mocks.startGitHubAccountDiscovery.mockResolvedValueOnce({
      browserUrl: 'https://broker.example/github/start?session=gad_123',
      sessionId: 'gad_123',
    });

    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await app.inject({
        headers: createAuthenticatedHeaders(),
        method: 'POST',
        payload: {
          returnTo: 'https://console.example/sources/git/setup',
        },
        url: '/v1/sources/git/providers/github/account-discovery',
      });

      expect(response.statusCode).toBe(200);
      const payload: GitHubAccountDiscoveryStartResponse = gitHubAccountDiscoveryStartResponseSchema.parse(
        response.json(),
      );
      expect(payload.sessionId).toBe('gad_123');
      expect(mocks.startGitHubAccountDiscovery).toHaveBeenCalledWith({
        returnTo: 'https://console.example/sources/git/setup',
      });
    });
  });

  it('reads GitHub account discovery result for an authenticated admin', async (): Promise<void> => {
    prepareAuthenticatedRoute('admin');
    mocks.readGitHubAccountDiscoveryResult.mockResolvedValueOnce(createGitHubAccountDiscoveryResultResponsePayload());

    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await app.inject({
        headers: createAuthenticatedHeaders(),
        method: 'POST',
        payload: {
          resultToken: 'result_123',
          sessionId: 'gad_123',
        },
        url: '/v1/sources/git/providers/github/account-discovery/result',
      });

      expect(response.statusCode).toBe(200);
      const payload: GitHubAccountDiscoveryResultResponse = gitHubAccountDiscoveryResultResponseSchema.parse(
        response.json(),
      );
      expect(payload.accounts.map((account: GitHubAccountDiscoveryAccount): string => account.login)).toEqual([
        'acme',
        'admin',
      ]);
      expect(mocks.readGitHubAccountDiscoveryResult).toHaveBeenCalledWith({
        organizationId: 'org_123',
        providerHost: 'github.com',
        request: {
          resultToken: 'result_123',
          sessionId: 'gad_123',
        },
      });
    });
  });

  it('lists GitHub installation repositories for an authenticated admin', async (): Promise<void> => {
    prepareAuthenticatedRoute('admin');
    mocks.listGitHubInstallationRepositories.mockResolvedValueOnce(
      createGitHubInstallationRepositoryListResponsePayload(),
    );

    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await app.inject({
        headers: createAuthenticatedHeaders(),
        method: 'GET',
        url: '/v1/sources/git/providers/github/registrations/gpr_123/repositories?providerHost=github.enterprise.example&repositoryOwner=acme',
      });

      expect(response.statusCode).toBe(200);
      const payload: GitHubInstallationRepositoryListResponse = gitHubInstallationRepositoryListResponseSchema.parse(
        response.json(),
      );
      expect(payload.repositories[0]?.fullName).toBe('acme/mono');
      expect(payload.status).toBe('ready');
      expect(mocks.listGitHubInstallationRepositories).toHaveBeenCalledWith({
        actor: createActor(),
        organizationId: 'org_123',
        providerHost: 'github.enterprise.example',
        registrationId: 'gpr_123',
        repositoryOwner: 'acme',
      });
    });
  });

  it('returns repository listing status from the service', async (): Promise<void> => {
    prepareAuthenticatedRoute('admin');
    mocks.listGitHubInstallationRepositories.mockResolvedValueOnce({
      repositories: [],
      status: 'provider_bootstrap_required',
    });

    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await app.inject({
        headers: createAuthenticatedHeaders(),
        method: 'GET',
        url: '/v1/sources/git/providers/github/registrations/gpr_123/repositories?providerHost=github.enterprise.example&repositoryOwner=acme',
      });

      expect(response.statusCode).toBe(200);
      const payload: GitHubInstallationRepositoryListResponse = gitHubInstallationRepositoryListResponseSchema.parse(
        response.json(),
      );
      expect(payload.status).toBe('provider_bootstrap_required');
    });
  });

  it('rejects repository listing without selected provider host and owner', async (): Promise<void> => {
    prepareAuthenticatedRoute('admin');

    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await app.inject({
        headers: createAuthenticatedHeaders(),
        method: 'GET',
        url: '/v1/sources/git/providers/github/registrations/gpr_123/repositories',
      });

      expectJsonError(response, 400, 'invalid_git_source_params');
      expect(mocks.listGitHubInstallationRepositories).not.toHaveBeenCalled();
    });
  });

  it('reads a Git descriptor plan for an authenticated admin', async (): Promise<void> => {
    prepareAuthenticatedRoute('admin');
    mocks.readGitDescriptorPlan.mockResolvedValueOnce(createGitDescriptorPlanResponsePayload());

    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await app.inject({
        headers: createAuthenticatedHeaders(),
        method: 'POST',
        payload: createGitDescriptorPlanRequestPayload(),
        url: '/v1/sources/git/descriptor-plan',
      });

      expect(response.statusCode).toBe(200);
      const payload: GitDescriptorPlanResponse = gitDescriptorPlanResponseSchema.parse(response.json());
      expect(payload.status).toBe('descriptor_missing');
      expect(mocks.readGitDescriptorPlan).toHaveBeenCalledWith({
        actor: createActor(),
        organizationId: 'org_123',
        request: createGitDescriptorPlanRequestPayload(),
      });
    });
  });

  it('returns a typed empty-repository error for descriptor plan reads', async (): Promise<void> => {
    prepareAuthenticatedRoute('admin');
    mocks.readGitDescriptorPlan.mockRejectedValueOnce(createGitSourceRepositoryEmptyError());

    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await app.inject({
        headers: createAuthenticatedHeaders(),
        method: 'POST',
        payload: createGitDescriptorPlanRequestPayload(),
        url: '/v1/sources/git/descriptor-plan',
      });

      expectJsonError(response, 409, 'git_source_repository_empty');
      expect(response.json()).toEqual({
        error: {
          code: 'git_source_repository_empty',
          message: 'The selected repository is empty. Add at least one commit to it, then try again.',
        },
      });
    });
  });

  it('creates a Git descriptor pull request for an authenticated admin', async (): Promise<void> => {
    prepareAuthenticatedRoute('admin');
    mocks.createGitDescriptorPullRequest.mockResolvedValueOnce(createGitDescriptorPullRequestResponsePayload());

    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await app.inject({
        headers: createAuthenticatedHeaders(),
        method: 'POST',
        payload: createGitDescriptorPullRequestRequestPayload(),
        url: '/v1/sources/git/descriptor-pr',
      });

      expect(response.statusCode).toBe(200);
      const payload: GitDescriptorPullRequestResponse = gitDescriptorPullRequestResponseSchema.parse(response.json());
      expect(payload.pullRequestNumber).toBe(17);
    });
  });

  it('reads Git descriptor pull request status without descriptor preview fields', async (): Promise<void> => {
    prepareAuthenticatedRoute('admin');
    mocks.readGitDescriptorPullRequestStatus.mockResolvedValueOnce(
      createGitDescriptorPullRequestStatusResponsePayload(),
    );

    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await app.inject({
        headers: createAuthenticatedHeaders(),
        method: 'POST',
        payload: {
          providerHost: 'github.enterprise.example',
          pullRequestNumber: 17,
          registrationId: 'gpr_123',
          repositoryName: 'mono',
          repositoryOwner: 'acme',
          statusToken: 'descriptor-pr-status-token',
        },
        url: '/v1/sources/git/descriptor-pr/status',
      });

      expect(response.statusCode).toBe(200);
      const payload: GitDescriptorPullRequestStatusResponse = gitDescriptorPullRequestStatusResponseSchema.parse(
        response.json(),
      );
      expect(payload).toEqual(createGitDescriptorPullRequestStatusResponsePayload());
    });
  });

  it('rejects descriptor plan reads for a non-admin actor', async (): Promise<void> => {
    prepareAuthenticatedRoute('deployer');

    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await app.inject({
        headers: createAuthenticatedHeaders(),
        method: 'POST',
        payload: createGitDescriptorPlanRequestPayload(),
        url: '/v1/sources/git/descriptor-plan',
      });

      expectJsonError(response, 403, 'forbidden');
      expect(mocks.readGitDescriptorPlan).not.toHaveBeenCalled();
    });
  });
});

function prepareAuthenticatedRoute(role: 'admin' | 'deployer'): void {
  applyApiRouteTestEnv();
  mocks.authenticateSession.mockResolvedValue(createActor());
  mocks.isAuthSessionAllowedForOrganization.mockResolvedValue(true);
  mocks.resolveInheritedAccess.mockResolvedValue({
    grantedScopeId: 'org_123',
    grantedScopeType: 'organization',
    permissions: listCompartmentRolePermissions(role),
  });
  mocks.resolveOrganizationForPrincipal.mockResolvedValue({
    id: 'org_123',
    name: 'Acme Dev',
    slug: 'acme-dev',
  });
}

function createActor(): Actor {
  return {
    authSession: {
      authMethodKind: 'password',
      oidcProviderId: null,
      organizationId: null,
      principalId: 'prn_123',
    },
    principalEmail: 'admin@example.com',
    principalId: 'prn_123',
    principalType: 'user',
    sessionId: 'ses_123',
    tokenHash: 'hashed-session-token',
  };
}

function createAuthenticatedHeaders(): Record<string, string> {
  return {
    authorization: 'Bearer session-token',
    'content-type': 'application/json',
    'x-compartment-organization': 'acme-dev',
  };
}

function createGitHubAccountDiscoveryResultResponsePayload(): GitHubAccountDiscoveryResultResponse {
  return {
    accounts: [
      {
        appInstallationStatus: 'installed',
        avatarUrl: 'https://avatars.example/acme.png',
        login: 'acme',
        type: 'organization',
      },
      {
        appInstallationStatus: 'not_installed',
        avatarUrl: null,
        login: 'admin',
        type: 'user',
      },
    ],
    user: {
      appInstallationStatus: 'not_installed',
      avatarUrl: null,
      login: 'admin',
      type: 'user',
    },
  };
}

function createGitHubInstallationRepositoryListResponsePayload(): GitHubInstallationRepositoryListResponse {
  return {
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
  };
}

function createGitDescriptorPlanRequestPayload(): GitDescriptorPlanRequest {
  return {
    branchName: 'main',
    providerHost: 'github.enterprise.example',
    registrationId: 'gpr_123',
    repositoryName: 'mono',
    repositoryOwner: 'acme',
  };
}

function createGitDescriptorPlanResponsePayload(): GitDescriptorPlanResponse {
  return {
    branchName: 'main',
    candidates: [
      {
        appFolder: '.',
        descriptorPath: 'compartment.yml',
        files: [
          {
            content:
              'name: mono\n\nservices:\n  web:\n    accessMode: public\n    kind: static\n    path: .\n    build:\n      outputDirectory: apps/site\n',
            path: 'compartment.yml',
          },
          {
            content:
              '<!doctype html>\n<html lang="en">\n  <head>\n    <meta charset="utf-8" />\n    <meta name="viewport" content="width=device-width, initial-scale=1" />\n    <title>Compartment Starter App</title>\n  </head>\n  <body>\n    <p>Hello, this is your first Compartment app.</p>\n  </body>\n</html>\n',
            path: 'apps/site/index.html',
          },
        ],
        id: 'compartment_yml',
        packageJsonPath: null,
        projectName: 'mono',
      },
    ],
    descriptorPath: null,
    preview: null,
    repositoryName: 'mono',
    repositoryOwner: 'acme',
    status: 'descriptor_missing',
  };
}

function createGitDescriptorPullRequestRequestPayload(): CreateGitDescriptorPullRequestRequest {
  return {
    appFolder: '.',
    branchName: 'main',
    descriptorPath: 'compartment.yml',
    files: [
      {
        content:
          'name: mono\n\nservices:\n  web:\n    accessMode: public\n    kind: static\n    path: .\n    build:\n      outputDirectory: apps/site\n',
        path: 'compartment.yml',
      },
      {
        content:
          '<!doctype html>\n<html lang="en">\n  <head>\n    <meta charset="utf-8" />\n    <meta name="viewport" content="width=device-width, initial-scale=1" />\n    <title>Compartment Starter App</title>\n  </head>\n  <body>\n    <p>Hello, this is your first Compartment app.</p>\n  </body>\n</html>\n',
        path: 'apps/site/index.html',
      },
    ],
    projectName: 'mono',
    providerHost: 'github.enterprise.example',
    registrationId: 'gpr_123',
    repositoryName: 'mono',
    repositoryOwner: 'acme',
  };
}

function createGitDescriptorPullRequestResponsePayload(): GitDescriptorPullRequestResponse {
  return {
    descriptorPath: 'compartment.yml',
    pullRequestNumber: 17,
    pullRequestUrl: 'https://github.enterprise.example/acme/mono/pull/17',
    state: 'open',
    statusToken: 'descriptor-pr-status-token',
  };
}

function createGitDescriptorPullRequestStatusResponsePayload(): GitDescriptorPullRequestStatusResponse {
  return {
    pullRequestNumber: 17,
    pullRequestUrl: 'https://github.enterprise.example/acme/mono/pull/17',
    state: 'open',
  };
}
