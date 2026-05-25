import type { LightMyRequestResponse } from 'fastify';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import {
  gitHubProviderBootstrapResponseSchema,
  gitSourceListResponseSchema,
  gitSourceResponseSchema,
  gitSourceSettingsResponseSchema,
  gitSourceSyncTaskResponseSchema,
  listCompartmentRolePermissions,
  compartmentSessionCookieName,
  type GitSourceBindingSummary,
  type GitHubProviderBootstrapResponse,
  type GitSourceListResponse,
  type GitSourceResponse,
  type GitSourceSettingsResponse,
  type GitSourceSyncTaskResponse,
} from '@compartment/contracts';
import { createGitSourceRepositoryAccessDeniedError } from '../src/errors/api-business-error';
import type { ApiApp } from '../src/app.types';
import type { Actor } from '../src/services/auth-actor.types';
import type { resolveInheritedAccess } from '../src/services/access-scope.service';
import type { authenticateBrowserCompartmentActor } from '../src/services/app-access.service';
import type { authenticateSession } from '../src/services/authentication.service';
import type { resolveOrganizationForPrincipal } from '../src/services/organizations.service';
import type { isAuthSessionAllowedForOrganization } from '../src/services/organization-auth-settings.service';
import type {
  readGitHubProviderBootstrapPage,
  readGitHubProviderBootstrapStatus,
  startGitHubProviderBootstrap,
} from '../src/services/git-source/git-source-bootstrap.service';
import type {
  completeGitHubProviderBootstrapCallback,
  completeGitHubProviderBootstrapSetup,
} from '../src/services/git-source/git-source-bootstrap-completion.service';
import type {
  connectGitSource,
  disconnectGitSource,
  listGitSources,
  readGitSource,
} from '../src/services/git-source/git-source.service';
import type {
  excludeGitSourceDescriptor,
  includeGitSourceDescriptor,
  readGitSourceSettings,
  updateGitSourceSettingsForSource,
} from '../src/services/git-source/git-source-settings.service';
import type { readGitSourceSyncTask, startGitSourceSync } from '../src/services/git-source/git-source-sync.service';
import type { GitSourceView } from '../src/services/git-source/git-source.service.types';
import type { recordAuditEvent } from '../src/services/audit-events.service';
import { gitSourcePublicRateLimitRouteOptions } from '../src/routes/sources/source-git-public-rate-limit.route';
import { applyApiRouteTestEnv, expectJsonError, withApiRouteApp } from './api-route-test.harness';

type AuthenticateSession = typeof authenticateSession;
type AuthenticateBrowserCompartmentActor = typeof authenticateBrowserCompartmentActor;
type ResolveInheritedAccess = typeof resolveInheritedAccess;
type ResolveOrganizationForPrincipal = typeof resolveOrganizationForPrincipal;
type IsAuthSessionAllowedForOrganization = typeof isAuthSessionAllowedForOrganization;
type ListGitSources = typeof listGitSources;
type ReadGitSource = typeof readGitSource;
type ConnectGitSource = typeof connectGitSource;
type DisconnectGitSource = typeof disconnectGitSource;
type ReadGitSourceSettings = typeof readGitSourceSettings;
type UpdateGitSourceSettingsForSource = typeof updateGitSourceSettingsForSource;
type ExcludeGitSourceDescriptor = typeof excludeGitSourceDescriptor;
type IncludeGitSourceDescriptor = typeof includeGitSourceDescriptor;
type StartGitSourceSync = typeof startGitSourceSync;
type ReadGitSourceSyncTask = typeof readGitSourceSyncTask;
type StartGitHubProviderBootstrap = typeof startGitHubProviderBootstrap;
type ReadGitHubProviderBootstrapStatus = typeof readGitHubProviderBootstrapStatus;
type ReadGitHubProviderBootstrapPage = typeof readGitHubProviderBootstrapPage;
type CompleteGitHubProviderBootstrapCallback = typeof completeGitHubProviderBootstrapCallback;
type CompleteGitHubProviderBootstrapSetup = typeof completeGitHubProviderBootstrapSetup;
type RecordAuditEvent = typeof recordAuditEvent;

const gitSourcePublicRateLimitMaxRequests: number = gitSourcePublicRateLimitRouteOptions.config.rateLimit.max;

interface SourceRouteMocks {
  authenticateBrowserCompartmentActor: Mock<AuthenticateBrowserCompartmentActor>;
  authenticateSession: Mock<AuthenticateSession>;
  completeGitHubProviderBootstrapCallback: Mock<CompleteGitHubProviderBootstrapCallback>;
  completeGitHubProviderBootstrapSetup: Mock<CompleteGitHubProviderBootstrapSetup>;
  connectGitSource: Mock<ConnectGitSource>;
  disconnectGitSource: Mock<DisconnectGitSource>;
  excludeGitSourceDescriptor: Mock<ExcludeGitSourceDescriptor>;
  isAuthSessionAllowedForOrganization: Mock<IsAuthSessionAllowedForOrganization>;
  includeGitSourceDescriptor: Mock<IncludeGitSourceDescriptor>;
  listGitSources: Mock<ListGitSources>;
  readGitHubProviderBootstrapPage: Mock<ReadGitHubProviderBootstrapPage>;
  readGitHubProviderBootstrapStatus: Mock<ReadGitHubProviderBootstrapStatus>;
  readGitSource: Mock<ReadGitSource>;
  readGitSourceSettings: Mock<ReadGitSourceSettings>;
  readGitSourceSyncTask: Mock<ReadGitSourceSyncTask>;
  recordAuditEvent: Mock<RecordAuditEvent>;
  resolveInheritedAccess: Mock<ResolveInheritedAccess>;
  resolveOrganizationForPrincipal: Mock<ResolveOrganizationForPrincipal>;
  startGitSourceSync: Mock<StartGitSourceSync>;
  startGitHubProviderBootstrap: Mock<StartGitHubProviderBootstrap>;
  updateGitSourceSettingsForSource: Mock<UpdateGitSourceSettingsForSource>;
}

const mocks: SourceRouteMocks = vi.hoisted(
  (): SourceRouteMocks => ({
    authenticateBrowserCompartmentActor: vi.fn<AuthenticateBrowserCompartmentActor>(),
    authenticateSession: vi.fn<AuthenticateSession>(),
    completeGitHubProviderBootstrapCallback: vi.fn<CompleteGitHubProviderBootstrapCallback>(),
    completeGitHubProviderBootstrapSetup: vi.fn<CompleteGitHubProviderBootstrapSetup>(),
    connectGitSource: vi.fn<ConnectGitSource>(),
    disconnectGitSource: vi.fn<DisconnectGitSource>(),
    excludeGitSourceDescriptor: vi.fn<ExcludeGitSourceDescriptor>(),
    isAuthSessionAllowedForOrganization: vi.fn<IsAuthSessionAllowedForOrganization>(),
    includeGitSourceDescriptor: vi.fn<IncludeGitSourceDescriptor>(),
    listGitSources: vi.fn<ListGitSources>(),
    readGitHubProviderBootstrapPage: vi.fn<ReadGitHubProviderBootstrapPage>(),
    readGitHubProviderBootstrapStatus: vi.fn<ReadGitHubProviderBootstrapStatus>(),
    readGitSource: vi.fn<ReadGitSource>(),
    readGitSourceSettings: vi.fn<ReadGitSourceSettings>(),
    readGitSourceSyncTask: vi.fn<ReadGitSourceSyncTask>(),
    recordAuditEvent: vi.fn<RecordAuditEvent>(),
    resolveInheritedAccess: vi.fn<ResolveInheritedAccess>(),
    resolveOrganizationForPrincipal: vi.fn<ResolveOrganizationForPrincipal>(),
    startGitSourceSync: vi.fn<StartGitSourceSync>(),
    startGitHubProviderBootstrap: vi.fn<StartGitHubProviderBootstrap>(),
    updateGitSourceSettingsForSource: vi.fn<UpdateGitSourceSettingsForSource>(),
  }),
);

interface AppAccessServiceModule {
  authenticateBrowserCompartmentActor: Mock<AuthenticateBrowserCompartmentActor>;
}

interface AuthenticationServiceModule {
  authenticateSession: Mock<AuthenticateSession>;
}

interface OrganizationsServiceModule {
  resolveOrganizationForPrincipal: Mock<ResolveOrganizationForPrincipal>;
}

interface OrganizationAuthSettingsServiceModule {
  isAuthSessionAllowedForOrganization: Mock<IsAuthSessionAllowedForOrganization>;
}

interface GitSourceServiceModule {
  connectGitSource: Mock<ConnectGitSource>;
  disconnectGitSource: Mock<DisconnectGitSource>;
  listGitSources: Mock<ListGitSources>;
  readGitSource: Mock<ReadGitSource>;
}

interface GitSourceSyncServiceModule {
  readGitSourceSyncTask: Mock<ReadGitSourceSyncTask>;
  startGitSourceSync: Mock<StartGitSourceSync>;
}

interface GitSourceSettingsServiceModule {
  excludeGitSourceDescriptor: Mock<ExcludeGitSourceDescriptor>;
  includeGitSourceDescriptor: Mock<IncludeGitSourceDescriptor>;
  readGitSourceSettings: Mock<ReadGitSourceSettings>;
  updateGitSourceSettingsForSource: Mock<UpdateGitSourceSettingsForSource>;
}

interface GitSourceBootstrapServiceModule {
  readGitHubProviderBootstrapPage: Mock<ReadGitHubProviderBootstrapPage>;
  readGitHubProviderBootstrapStatus: Mock<ReadGitHubProviderBootstrapStatus>;
  renderGitHubProviderBootstrapSuccessPage: () => string;
  startGitHubProviderBootstrap: Mock<StartGitHubProviderBootstrap>;
}

interface GitSourceBootstrapCompletionServiceModule {
  completeGitHubProviderBootstrapCallback: Mock<CompleteGitHubProviderBootstrapCallback>;
  completeGitHubProviderBootstrapSetup: Mock<CompleteGitHubProviderBootstrapSetup>;
}

interface AuditEventsServiceModule {
  recordAuditEvent: Mock<RecordAuditEvent>;
}

vi.mock(
  '../src/services/app-access.service',
  (): AppAccessServiceModule => ({
    authenticateBrowserCompartmentActor: mocks.authenticateBrowserCompartmentActor,
  }),
);

vi.mock(
  '../src/services/authentication.service',
  (): AuthenticationServiceModule => ({
    authenticateSession: mocks.authenticateSession,
  }),
);

vi.mock(
  '../src/services/organizations.service',
  (): OrganizationsServiceModule => ({
    resolveOrganizationForPrincipal: mocks.resolveOrganizationForPrincipal,
  }),
);

vi.mock('../src/services/access-scope.service', (): { resolveInheritedAccess: Mock<ResolveInheritedAccess> } => ({
  resolveInheritedAccess: mocks.resolveInheritedAccess,
}));

vi.mock(
  '../src/services/organization-auth-settings.service',
  (): OrganizationAuthSettingsServiceModule => ({
    isAuthSessionAllowedForOrganization: mocks.isAuthSessionAllowedForOrganization,
  }),
);

vi.mock(
  '../src/services/git-source/git-source.service',
  (): GitSourceServiceModule => ({
    connectGitSource: mocks.connectGitSource,
    disconnectGitSource: mocks.disconnectGitSource,
    listGitSources: mocks.listGitSources,
    readGitSource: mocks.readGitSource,
  }),
);

vi.mock(
  '../src/services/git-source/git-source-sync.service',
  (): GitSourceSyncServiceModule => ({
    readGitSourceSyncTask: mocks.readGitSourceSyncTask,
    startGitSourceSync: mocks.startGitSourceSync,
  }),
);

vi.mock(
  '../src/services/git-source/git-source-settings.service',
  (): GitSourceSettingsServiceModule => ({
    excludeGitSourceDescriptor: mocks.excludeGitSourceDescriptor,
    includeGitSourceDescriptor: mocks.includeGitSourceDescriptor,
    readGitSourceSettings: mocks.readGitSourceSettings,
    updateGitSourceSettingsForSource: mocks.updateGitSourceSettingsForSource,
  }),
);

vi.mock(
  '../src/services/audit-events.service',
  (): AuditEventsServiceModule => ({
    recordAuditEvent: mocks.recordAuditEvent,
  }),
);

vi.mock(
  '../src/services/git-source/git-source-bootstrap.service',
  (): GitSourceBootstrapServiceModule => ({
    readGitHubProviderBootstrapPage: mocks.readGitHubProviderBootstrapPage,
    readGitHubProviderBootstrapStatus: mocks.readGitHubProviderBootstrapStatus,
    renderGitHubProviderBootstrapSuccessPage: (): string => '<html>ok</html>',
    startGitHubProviderBootstrap: mocks.startGitHubProviderBootstrap,
  }),
);

vi.mock(
  '../src/services/git-source/git-source-bootstrap-completion.service',
  (): GitSourceBootstrapCompletionServiceModule => ({
    completeGitHubProviderBootstrapCallback: mocks.completeGitHubProviderBootstrapCallback,
    completeGitHubProviderBootstrapSetup: mocks.completeGitHubProviderBootstrapSetup,
  }),
);

describe('git source routes', (): void => {
  afterEach((): void => {
    vi.resetAllMocks();
  });

  it('lists sources for an authenticated deployer', async (): Promise<void> => {
    prepareAuthenticatedRoute('deployer');
    mocks.listGitSources.mockResolvedValueOnce([
      {
        source: {
          defaultBranchName: 'main',
          displayName: 'acme/mono',
          id: 'src_123',
          providerHost: 'github.com',
          repositoryCloneUrl: 'https://github.com/acme/mono.git',
          repositoryName: 'mono',
          repositoryOwner: 'acme',
          status: 'active',
        },
      },
    ]);

    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await app.inject({
        headers: createAuthenticatedHeaders(),
        method: 'GET',
        url: '/v1/sources',
      });

      expect(response.statusCode).toBe(200);
      const payload: GitSourceListResponse = gitSourceListResponseSchema.parse(response.json());
      expect(expectPresent(payload.sources[0], 'source').displayName).toBe('acme/mono');
    });
  });

  it('rejects bootstrap start for a non-admin organization actor', async (): Promise<void> => {
    prepareAuthenticatedRoute('deployer');

    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await app.inject({
        headers: createAuthenticatedHeaders(),
        method: 'POST',
        payload: {
          providerHost: 'github.com',
          repositoryOwner: 'acme',
        },
        url: '/v1/sources/git/providers/github/bootstrap',
      });

      expectJsonError(response, 403, 'forbidden');
      expect(mocks.startGitHubProviderBootstrap).not.toHaveBeenCalled();
    });
  });

  it('rejects bootstrap start with an unsafe return path', async (): Promise<void> => {
    prepareAuthenticatedRoute('admin');

    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await app.inject({
        headers: createAuthenticatedHeaders(),
        method: 'POST',
        payload: {
          providerHost: 'github.com',
          repositoryOwner: 'acme',
          returnTo: '//evil.example/phish',
        },
        url: '/v1/sources/git/providers/github/bootstrap',
      });

      expect(response.statusCode).toBe(400);
      expect(response.body).toContain('invalid_git_source_request');
    });
  });

  it('shows a source for an authenticated deployer', async (): Promise<void> => {
    prepareAuthenticatedRoute('deployer');
    mocks.readGitSource.mockResolvedValueOnce(createGitSourceView());

    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await app.inject({
        headers: createAuthenticatedHeaders(),
        method: 'GET',
        url: '/v1/sources/src_123',
      });

      expect(response.statusCode).toBe(200);
      const payload: GitSourceResponse = gitSourceResponseSchema.parse(response.json());
      expect(payload.source.id).toBe('src_123');
      expect(payload.source.bindings).toHaveLength(1);
    });
  });

  it('disconnects a source for an authenticated admin', async (): Promise<void> => {
    prepareAuthenticatedRoute('admin');
    mocks.disconnectGitSource.mockResolvedValueOnce(createGitSourceView());

    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await app.inject({
        headers: createAuthenticatedHeaders(),
        method: 'DELETE',
        payload: {},
        url: '/v1/sources/src_123',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        sourceId: 'src_123',
        success: true,
      });
    });
  });

  it('reads source settings for an authenticated deployer', async (): Promise<void> => {
    prepareAuthenticatedRoute('deployer');
    mocks.readGitSourceSettings.mockResolvedValueOnce(createGitSourceSettingsResponsePayload().settings);

    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await app.inject({
        headers: createAuthenticatedHeaders(),
        method: 'GET',
        url: '/v1/sources/src_123/settings',
      });

      expect(response.statusCode).toBe(200);
      const payload: GitSourceSettingsResponse = gitSourceSettingsResponseSchema.parse(response.json());
      expect(payload.settings.exclusions).toHaveLength(1);
    });
  });

  it('updates source settings for an authenticated admin', async (): Promise<void> => {
    prepareAuthenticatedRoute('admin');
    mocks.updateGitSourceSettingsForSource.mockResolvedValueOnce(createGitSourceSettingsResponsePayload().settings);
    mocks.readGitSource.mockResolvedValueOnce(createGitSourceView());

    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await app.inject({
        headers: createAuthenticatedHeaders(),
        method: 'PATCH',
        payload: {
          autoAdoptNewApps: false,
        },
        url: '/v1/sources/src_123/settings',
      });

      expect(response.statusCode).toBe(200);
      const payload: GitSourceSettingsResponse = gitSourceSettingsResponseSchema.parse(response.json());
      expect(payload.settings.autoAdoptNewApps).toBe(false);
    });
  });

  it('excludes a descriptor for an authenticated admin', async (): Promise<void> => {
    prepareAuthenticatedRoute('admin');
    mocks.excludeGitSourceDescriptor.mockResolvedValueOnce();

    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await app.inject({
        headers: createAuthenticatedHeaders(),
        method: 'POST',
        payload: {
          descriptorPath: 'apps/billing/compartment.yml',
        },
        url: '/v1/sources/src_123/exclude',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        descriptorPath: 'apps/billing/compartment.yml',
        sourceId: 'src_123',
        success: true,
      });
    });
  });

  it('includes a descriptor for an authenticated admin', async (): Promise<void> => {
    prepareAuthenticatedRoute('admin');
    mocks.includeGitSourceDescriptor.mockResolvedValueOnce(createGitSourceSyncTaskResponsePayload().task);
    mocks.readGitSource.mockResolvedValueOnce(createGitSourceView());

    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await app.inject({
        headers: createAuthenticatedHeaders(),
        method: 'POST',
        payload: {
          descriptorPath: 'apps/billing/compartment.yml',
        },
        url: '/v1/sources/src_123/include',
      });

      expect(response.statusCode).toBe(200);
      const payload: GitSourceSyncTaskResponse = gitSourceSyncTaskResponseSchema.parse(response.json());
      expect(payload.task.id).toBe('sst_123');
    });
  });

  it('starts source sync for an authenticated admin', async (): Promise<void> => {
    prepareAuthenticatedRoute('admin');
    mocks.startGitSourceSync.mockResolvedValueOnce(createGitSourceSyncTaskResponsePayload().task);
    mocks.readGitSource.mockResolvedValueOnce(createGitSourceView());

    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await app.inject({
        headers: createAuthenticatedHeaders(),
        method: 'POST',
        payload: {},
        url: '/v1/sources/src_123/sync',
      });

      expect(response.statusCode).toBe(200);
      const payload: GitSourceSyncTaskResponse = gitSourceSyncTaskResponseSchema.parse(response.json());
      expect(payload.task.status).toBe('pending');
    });
  });

  it('reads source sync task for an authenticated deployer', async (): Promise<void> => {
    prepareAuthenticatedRoute('deployer');
    mocks.readGitSourceSyncTask.mockResolvedValueOnce(createGitSourceSyncTaskResponsePayload().task);

    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await app.inject({
        headers: createAuthenticatedHeaders(),
        method: 'GET',
        url: '/v1/sources/src_123/sync/sst_123',
      });

      expect(response.statusCode).toBe(200);
      const payload: GitSourceSyncTaskResponse = gitSourceSyncTaskResponseSchema.parse(response.json());
      expect(payload.task.id).toBe('sst_123');
    });
  });

  it('rejects source disconnect for a non-admin actor', async (): Promise<void> => {
    prepareAuthenticatedRoute('deployer');

    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await app.inject({
        headers: createAuthenticatedHeaders(),
        method: 'DELETE',
        payload: {},
        url: '/v1/sources/src_123',
      });

      expectJsonError(response, 403, 'forbidden');
      expect(mocks.disconnectGitSource).not.toHaveBeenCalled();
    });
  });

  it('rejects source sync start for a non-admin actor', async (): Promise<void> => {
    prepareAuthenticatedRoute('deployer');

    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await app.inject({
        headers: createAuthenticatedHeaders(),
        method: 'POST',
        payload: {},
        url: '/v1/sources/src_123/sync',
      });

      expectJsonError(response, 403, 'forbidden');
      expect(mocks.startGitSourceSync).not.toHaveBeenCalled();
    });
  });

  it('reads bootstrap status for an authenticated admin', async (): Promise<void> => {
    prepareAuthenticatedRoute('admin');
    mocks.readGitHubProviderBootstrapStatus.mockResolvedValueOnce({
      bootstrapStateId: 'gps_123',
      browserUrl: null,
      installationAccountLogin: 'acme',
      installationId: '98765',
      providerHost: 'github.com',
      registrationId: 'gpr_123',
      repositoryOwner: 'acme',
      status: 'active',
    });

    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await app.inject({
        headers: createAuthenticatedHeaders(),
        method: 'GET',
        url: '/v1/sources/git/providers/github/bootstrap/gps_123',
      });

      expect(response.statusCode).toBe(200);
      const payload: GitHubProviderBootstrapResponse = gitHubProviderBootstrapResponseSchema.parse(response.json());
      expect(payload).toEqual({
        bootstrapStateId: 'gps_123',
        browserUrl: null,
        installationAccountLogin: 'acme',
        installationId: '98765',
        providerHost: 'github.com',
        registrationId: 'gpr_123',
        repositoryOwner: 'acme',
        status: 'active',
      });
    });
  });

  it('rejects an invalid source connect payload before hitting the service', async (): Promise<void> => {
    prepareAuthenticatedRoute('admin');

    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await app.inject({
        headers: createAuthenticatedHeaders(),
        method: 'POST',
        payload: {
          autoAdoptNewApps: true,
          defaultAutoDeployEnabled: true,
          defaultEnvironmentName: 'production',
          providerHost: 'https://github.com',
          repositoryName: 'mono',
          repositoryOwner: 'acme',
          syncBranchName: 'main',
        },
        url: '/v1/sources/git/connect',
      });

      expectJsonError(response, 400, 'invalid_git_source_request');
      expect(mocks.connectGitSource).not.toHaveBeenCalled();
    });
  });

  it('redirects bootstrap start to login without a browser session', async (): Promise<void> => {
    applyApiRouteTestEnv();
    mocks.authenticateBrowserCompartmentActor.mockResolvedValueOnce(null);

    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await app.inject({
        method: 'GET',
        url: '/v1/sources/git/providers/github/bootstrap/gps_123/start',
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toBe('/login');
      expect(mocks.readGitHubProviderBootstrapPage).not.toHaveBeenCalled();
    });
  });

  it('serves the bootstrap start page for an authenticated browser admin', async (): Promise<void> => {
    applyApiRouteTestEnv();
    mocks.authenticateBrowserCompartmentActor.mockResolvedValueOnce(createActor('admin'));
    mocks.readGitHubProviderBootstrapPage.mockResolvedValueOnce({
      formActionUrl: 'https://github.com/organizations/acme/settings/apps/new',
      kind: 'manifest',
      manifestJson: '{"name":"Compartment"}',
      stateNonce: 'gst_123',
    });

    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await app.inject({
        headers: createBrowserSessionHeaders(),
        method: 'GET',
        url: '/v1/sources/git/providers/github/bootstrap/gps_123/start',
      });

      expect(response.statusCode).toBe(200);
      expect(response.body).toContain('Redirecting to GitHub App registration');
      expect(response.body).toContain('name="state" value="gst_123"');
    });
  });

  it('serves a delayed install page for a completed app manifest bootstrap', async (): Promise<void> => {
    applyApiRouteTestEnv();
    mocks.authenticateBrowserCompartmentActor.mockResolvedValueOnce(createActor('admin'));
    mocks.readGitHubProviderBootstrapPage.mockResolvedValueOnce({
      installUrl: 'https://github.com/apps/compartment/installations/new?state=gps_123',
      kind: 'install',
    });

    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await app.inject({
        headers: createBrowserSessionHeaders(),
        method: 'GET',
        url: '/v1/sources/git/providers/github/bootstrap/gps_123/start',
      });

      expect(response.statusCode).toBe(200);
      expect(response.body).toContain('Preparing GitHub App installation');
      expect(response.body).toContain('https://github.com/apps/compartment/installations/new?state=gps_123');
      expect(response.body).toContain('window.setTimeout');
    });
  });

  it('rate limits the public bootstrap start page', async (): Promise<void> => {
    applyApiRouteTestEnv();
    mocks.authenticateBrowserCompartmentActor.mockResolvedValue(createActor('admin'));
    mocks.readGitHubProviderBootstrapPage.mockResolvedValue({
      formActionUrl: 'https://github.com/organizations/acme/settings/apps/new',
      kind: 'manifest',
      manifestJson: '{"name":"Compartment"}',
      stateNonce: 'gst_123',
    });

    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      for (let index: number = 0; index < gitSourcePublicRateLimitMaxRequests; index += 1) {
        const response: LightMyRequestResponse = await app.inject({
          headers: createBrowserSessionHeaders(),
          method: 'GET',
          url: '/v1/sources/git/providers/github/bootstrap/gps_123/start',
        });

        expect(response.statusCode).toBe(200);
      }

      const blockedResponse: LightMyRequestResponse = await app.inject({
        headers: createBrowserSessionHeaders(),
        method: 'GET',
        url: '/v1/sources/git/providers/github/bootstrap/gps_123/start',
      });

      expectJsonError(blockedResponse, 429, 'api_rate_limit_exceeded');
    });
  });

  it('completes the public GitHub callback with a delayed install page', async (): Promise<void> => {
    applyApiRouteTestEnv();
    mocks.completeGitHubProviderBootstrapCallback.mockResolvedValueOnce(
      'https://github.com/apps/compartment/installations/new?state=gps_123',
    );

    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await app.inject({
        method: 'GET',
        url: '/v1/sources/git/providers/github/callback?code=abc&state=nonce',
      });

      expect(response.statusCode).toBe(200);
      expect(response.body).toContain('Preparing GitHub App installation');
      expect(response.body).toContain('https://github.com/apps/compartment/installations/new?state=gps_123');
      expect(response.body).toContain('window.setTimeout');
    });
  });

  it('rejects an invalid public GitHub callback query', async (): Promise<void> => {
    applyApiRouteTestEnv();

    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await app.inject({
        method: 'GET',
        url: '/v1/sources/git/providers/github/callback?state=nonce',
      });

      expectJsonError(response, 400, 'git_source_bootstrap_invalid');
      expect(mocks.completeGitHubProviderBootstrapCallback).not.toHaveBeenCalled();
    });
  });

  it('completes the public GitHub setup callback', async (): Promise<void> => {
    applyApiRouteTestEnv();
    mocks.completeGitHubProviderBootstrapSetup.mockResolvedValueOnce(null);

    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await app.inject({
        method: 'GET',
        url: '/v1/sources/git/providers/github/setup?installation_id=123&state=gps_123',
      });

      expect(response.statusCode).toBe(200);
      expect(response.body).toContain('<html>ok</html>');
    });
  });

  it('redirects the public GitHub setup callback when bootstrap has a return path', async (): Promise<void> => {
    applyApiRouteTestEnv();
    mocks.completeGitHubProviderBootstrapSetup.mockResolvedValueOnce('/sources/git/setup-complete?step=repo');

    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await app.inject({
        method: 'GET',
        url: '/v1/sources/git/providers/github/setup?installation_id=123&state=gps_123',
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toBe('/sources/git/setup-complete?step=repo');
    });
  });

  it('does not redirect the public GitHub setup callback to an unsafe return path', async (): Promise<void> => {
    applyApiRouteTestEnv();
    mocks.completeGitHubProviderBootstrapSetup.mockResolvedValueOnce('https://evil.example/phish');

    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await app.inject({
        method: 'GET',
        url: '/v1/sources/git/providers/github/setup?installation_id=123&state=gps_123',
      });

      expect(response.statusCode).toBe(500);
      expect(response.headers.location).toBeUndefined();
    });
  });

  it('returns a typed repository-access error for public GitHub setup verification failures', async (): Promise<void> => {
    applyApiRouteTestEnv();
    mocks.completeGitHubProviderBootstrapSetup.mockRejectedValueOnce(createGitSourceRepositoryAccessDeniedError());

    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await app.inject({
        method: 'GET',
        url: '/v1/sources/git/providers/github/setup?installation_id=123&state=gps_123',
      });

      expectJsonError(response, 409, 'git_source_repository_access_denied');
      expect(response.json()).toEqual({
        error: {
          code: 'git_source_repository_access_denied',
          message: 'The GitHub App is not installed on the selected repository.',
        },
      });
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

function createActor(_role?: 'admin' | 'deployer'): Actor {
  void _role;

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

function createAuthenticatedHeaders({
  includeContentType = true,
}: {
  includeContentType?: boolean;
} = {}): Record<string, string> {
  return {
    authorization: 'Bearer session-token',
    ...(includeContentType ? { 'content-type': 'application/json' } : {}),
    'x-compartment-organization': 'acme-dev',
  };
}

function createBrowserSessionHeaders(): Record<string, string> {
  return {
    cookie: `${compartmentSessionCookieName}=session-token`,
  };
}

function expectPresent<T>(value: T | null | undefined, label: string): T {
  expect(value, `${label} should be present`).not.toBeNull();
  expect(value, `${label} should be present`).not.toBeUndefined();
  return value as T;
}

function createGitSourceView(bindings: GitSourceBindingSummary[] = defaultGitSourceBindings()): GitSourceView {
  return {
    bindings,
    source: {
      autoAdoptNewApps: true,
      defaultAutoDeployEnabled: true,
      defaultBranchName: 'main',
      defaultEnvironmentName: 'production',
      displayName: 'acme/mono',
      exclusions: [],
      id: 'src_123',
      latestSync: null,
      providerHost: 'github.com',
      repositoryCloneUrl: 'https://github.com/acme/mono.git',
      repositoryName: 'mono',
      repositoryOwner: 'acme',
      status: 'active',
    },
  };
}

function createGitSourceSettingsResponsePayload(): GitSourceSettingsResponse {
  return {
    settings: {
      autoAdoptNewApps: false,
      exclusions: [
        {
          descriptorPath: 'apps/billing/compartment.yml',
        },
      ],
    },
  };
}

function createGitSourceSyncTaskResponsePayload(): GitSourceSyncTaskResponse {
  return {
    task: {
      candidates: [],
      failureReason: null,
      id: 'sst_123',
      requestedBranchName: 'main',
      resolvedCommitSha: null,
      status: 'pending',
    },
  };
}

function defaultGitSourceBindings(): GitSourceBindingSummary[] {
  return [
    {
      autoDeployEnabled: true,
      branchName: 'main',
      descriptorPath: 'compartment.yml',
      environmentName: 'production',
      id: 'sbd_123',
      projectId: 'prj_123',
      projectName: 'smoke-web',
      status: 'active',
    },
  ];
}
