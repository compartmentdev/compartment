import {
  buildDefaultSsoOidcIdentityVerificationConfig,
  compartmentSessionCookieName,
  nodeResourceDeletePathname,
  nodeResourceReconcilePathname,
  nodeResourceRestartPolicyPathname,
  nodeResourceStopPathname,
  deployResponseSchema,
  errorResponseSchema,
  installResponseSchema,
  nodeRegistrationResponseSchema,
  createOrganizationResponseSchema,
  organizationListResponseSchema,
  resourceListResponseSchema,
  resourceOutputListResponseSchema,
  type CompartmentAuthoredDescriptor,
  type CompartmentAuthoredDescriptorInput,
  type CompartmentAuthoredResourceConfig,
  type DeploymentSummary,
  type DeployResponse,
  type CreateOrganizationResponse,
  type InstallResponse,
  type ResourceOutputListResponse,
  type SetVariableRequest,
  type SourceUploadSummary,
  type WorkerClaimedDeployment,
  compartmentCurrentOrganizationHeaderName,
} from '@compartment/contracts';
import type { LightMyRequestResponse } from 'fastify';
import type { Pool } from 'pg';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  createOrganizationMemberSession,
  createStoredAppAccessSession as createStoredAppAccessSessionFixture,
  createStoredSsoOidcProvider as createStoredSsoOidcProviderFixture,
  readStoredAppAccessSession as readStoredAppAccessSessionFixture,
  readStoredAuthSession as readStoredAuthSessionFixture,
  readStoredSsoOidcProvider as readStoredSsoOidcProviderFixture,
  type StoredBrowserSession,
} from './api-auth-session-test.fixtures';
import type { ApiApp } from '../src/app.types';
import type { ApiConfig } from '../src/config';
import { createDatabase, createDatabasePool, type Database } from '../src/db/client';

import {
  authSessions,
  buildArtifacts,
  deployments,
  operations,
  organizationMemberships,
  principals,
  projectResources,
  projects,
  sourceUploads,
  environmentVariableValues,
} from '../src/db/schema';
import { hashToken } from '../src/lib/tokens';

import {
  browserHomePathname,
  browserLoginPathname,
  browserOrganizationUsersPathnameTemplate,
} from '../src/browser-public-paths';
import { reconcileDeclaredResources } from '../src/services/resources-reconcile.service';
import {
  buildOrganizationAuthorizationHeaders,
  buildMultipartRequest,
  createUploadedSourceArchive,
  clearIntegrationNodeAgentRequests,
  createMultipartFieldPart,
  createMultipartFilePart,
  createSourceArchive,
  injectSourceUploadRequest,
  injectDeployRequest,
  injectJsonDeployRequest,
  injectNodeRegistrationRequest,
  installCompartment,
  queueIntegrationNodeAgentError,
  queueIntegrationNodeAgentResponse,
  registerLocalNode,
  claimNextQueuedDeployment,
  readIntegrationNodeAgentRequestBody,
  readIntegrationNodeAgentRequests,
  requireClaimedDeployment,
  requireDeployResponseDeployment,
  setVariable,
  type MultipartRequest,
} from './api-integration.harness';
import type { StoredOperationRow } from './api.integration.types';
import {
  createApiIntegrationApps,
  createApiIntegrationTestContext,
  cleanupApiIntegrationRuntime,
  cleanupApiIntegrationTlsDirectory,
  configureApiRuntimeWithPublicIngress,
  resetApiIntegrationTlsDirectory,
} from './api-app-test.harness';
import { useApiDatabaseTestHarness } from './api-db-test.harness';

type InvalidateEdgeAppAccessSessions = () => Promise<void>;
type SynchronizeEdgeAppAccessState = () => Promise<void>;
type ResolveDnsRecord = (hostname: string) => Promise<string[]>;
type ResolveTxtRecord = (hostname: string) => Promise<string[][]>;

interface AppAccessEdgeServiceMocks {
  invalidateEdgeAppAccessSessions: Mock<InvalidateEdgeAppAccessSessions>;
  synchronizeEdgeAppAccessState: Mock<SynchronizeEdgeAppAccessState>;
}

interface DnsPromiseMocks {
  resolve4: Mock<ResolveDnsRecord>;
  resolve6: Mock<ResolveDnsRecord>;
  resolveCname: Mock<ResolveDnsRecord>;
  resolveTxt: Mock<ResolveTxtRecord>;
}

interface ResourceRequestEnvInput {
  keyName: string;
  value: string;
}

const postgresPresetPasswordEnvName: string = 'POSTGRES_PASSWORD';

interface ResourceRequestInput {
  definition: {
    env: ResourceRequestEnvInput[];
  };
}

const appAccessEdgeServiceMocks: AppAccessEdgeServiceMocks = vi.hoisted(
  (): AppAccessEdgeServiceMocks => ({
    invalidateEdgeAppAccessSessions: vi.fn<InvalidateEdgeAppAccessSessions>(),
    synchronizeEdgeAppAccessState: vi.fn<SynchronizeEdgeAppAccessState>(),
  }),
);

const dnsPromiseMocks: DnsPromiseMocks = vi.hoisted(
  (): DnsPromiseMocks => ({
    resolve4: vi.fn<ResolveDnsRecord>(),
    resolve6: vi.fn<ResolveDnsRecord>(),
    resolveCname: vi.fn<ResolveDnsRecord>(),
    resolveTxt: vi.fn<ResolveTxtRecord>(),
  }),
);

vi.mock(
  '../src/services/app-access-edge.service',
  (): AppAccessEdgeServiceMocks => ({
    invalidateEdgeAppAccessSessions: appAccessEdgeServiceMocks.invalidateEdgeAppAccessSessions,
    synchronizeEdgeAppAccessState: appAccessEdgeServiceMocks.synchronizeEdgeAppAccessState,
  }),
);

vi.mock(
  'node:dns/promises',
  (): DnsPromiseMocks => ({
    resolve4: dnsPromiseMocks.resolve4,
    resolve6: dnsPromiseMocks.resolve6,
    resolveCname: dnsPromiseMocks.resolveCname,
    resolveTxt: dnsPromiseMocks.resolveTxt,
  }),
);

interface CreateOrganizationMemberOidcSessionInput {
  email: string;
  installPayload: InstallResponse;
  oidcProviderId: string;
  principalId: string;
  sessionId: string;
  sessionToken: string;
}

const {
  apiConfig: baseApiConfig,
  databaseUrl: apiIntegrationDatabaseUrl,
  testCustomTlsDirectory,
} = createApiIntegrationTestContext('api_integration_deploy_submission', 'api-integration-deploy-submission');
const defaultApiConfig: ApiConfig = {
  ...baseApiConfig,
  trustedOutboundHosts: ['sop_update.example.com', 'sop_partial.example.com'],
};
let pool!: Pool;
let db!: Database;
let app!: ApiApp;
let systemApp!: ApiApp;
let hasInitializedApiIntegrationRuntime: boolean = false;

describe('Phase 0 API integration deploy submission', (): void => {
  useApiDatabaseTestHarness(apiIntegrationDatabaseUrl);

  beforeEach(async (): Promise<void> => {
    appAccessEdgeServiceMocks.invalidateEdgeAppAccessSessions.mockReset();
    appAccessEdgeServiceMocks.invalidateEdgeAppAccessSessions.mockResolvedValue(undefined);
    appAccessEdgeServiceMocks.synchronizeEdgeAppAccessState.mockReset();
    appAccessEdgeServiceMocks.synchronizeEdgeAppAccessState.mockResolvedValue(undefined);
    dnsPromiseMocks.resolve4.mockReset();
    dnsPromiseMocks.resolve4.mockResolvedValue(['203.0.113.10']);
    dnsPromiseMocks.resolve6.mockReset();
    dnsPromiseMocks.resolve6.mockRejectedValue(new Error('No AAAA record.'));
    dnsPromiseMocks.resolveCname.mockReset();
    dnsPromiseMocks.resolveCname.mockRejectedValue(new Error('No CNAME record.'));
    dnsPromiseMocks.resolveTxt.mockReset();
    dnsPromiseMocks.resolveTxt.mockRejectedValue(new Error('No TXT record.'));
    await resetApiIntegrationTlsDirectory(testCustomTlsDirectory);
    pool = createDatabasePool(apiIntegrationDatabaseUrl);
    db = createDatabase(pool);
    ({ app, systemApp } = await createApiIntegrationApps(defaultApiConfig, db, pool));
    configureApiRuntimeWithPublicIngress(defaultApiConfig, db);
    hasInitializedApiIntegrationRuntime = true;
  });
  afterAll(async (): Promise<void> => {
    await cleanupApiIntegrationTlsDirectory(testCustomTlsDirectory);
  });
  afterEach(async (): Promise<void> => {
    vi.unstubAllGlobals();
    if (!hasInitializedApiIntegrationRuntime) {
      return;
    }

    hasInitializedApiIntegrationRuntime = false;
    await cleanupApiIntegrationRuntime(app, systemApp, pool);
  });
  it('revokes stale browser OIDC sessions after deleting an OIDC provider', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);
    await createStoredSsoOidcProvider('sop_delete', installPayload.organization.id);
    const browserSession: StoredBrowserSession = await createOrganizationMemberOidcSession({
      email: 'oidc-delete@example.com',
      installPayload,
      oidcProviderId: 'sop_delete',
      principalId: 'prn_oidc_delete',
      sessionId: 'ses_oidc_delete',
      sessionToken: 'oidc-delete-session-token',
    });
    await createStoredAppAccessSession('aps_oidc_delete', browserSession.sessionId);

    const deleteProviderResponse: LightMyRequestResponse = await app.inject({
      headers: buildOrganizationAuthorizationHeaders(installPayload.sessionToken),
      method: 'DELETE',
      url: '/v1/sso/oidc/providers/sop_delete',
    });
    expect(deleteProviderResponse.statusCode).toBe(200);

    expect((await readStoredAuthSession(browserSession.sessionId)).revokedAt).not.toBeNull();
    expect((await readStoredAppAccessSession('aps_oidc_delete')).revokedAt).not.toBeNull();
    expect(appAccessEdgeServiceMocks.invalidateEdgeAppAccessSessions).toHaveBeenCalledWith(browserSession.sessionId);

    const browserProjectsResponse: LightMyRequestResponse = await app.inject({
      method: 'GET',
      url: browserHomePathname,
      headers: {
        cookie: `${compartmentSessionCookieName}=${browserSession.sessionToken}`,
      },
    });
    expect(browserProjectsResponse.statusCode).toBe(302);
    expect(browserProjectsResponse.headers.location).toBe(browserLoginPathname);
  });

  it('revokes stale browser OIDC sessions after updating an OIDC provider', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);
    await createStoredSsoOidcProvider('sop_update', installPayload.organization.id);
    const browserSession: StoredBrowserSession = await createOrganizationMemberOidcSession({
      email: 'oidc-update@example.com',
      installPayload,
      oidcProviderId: 'sop_update',
      principalId: 'prn_oidc_update',
      sessionId: 'ses_oidc_update',
      sessionToken: 'oidc-update-session-token',
    });
    await createStoredAppAccessSession('aps_oidc_update', browserSession.sessionId);

    const updateProviderResponse: LightMyRequestResponse = await app.inject({
      headers: buildOrganizationAuthorizationHeaders(installPayload.sessionToken),
      method: 'PATCH',
      payload: {
        clientId: 'client_sop_update',
        clientSecret: 'rotated-secret',
        displayName: 'Single sign-on',
        identityVerification: buildDefaultSsoOidcIdentityVerificationConfig(),
        issuerUrl: 'https://sop_update.example.com',
        preset: 'generic',
        scope: 'openid email profile',
      },
      url: '/v1/sso/oidc/providers/sop_update',
    });
    expect(updateProviderResponse.statusCode).toBe(200);

    expect((await readStoredAuthSession(browserSession.sessionId)).revokedAt).not.toBeNull();
    expect((await readStoredAppAccessSession('aps_oidc_update')).revokedAt).not.toBeNull();
    expect(appAccessEdgeServiceMocks.invalidateEdgeAppAccessSessions).toHaveBeenCalledWith(browserSession.sessionId);

    const browserUsersResponse: LightMyRequestResponse = await app.inject({
      method: 'GET',
      url: browserOrganizationUsersPathnameTemplate.replace(':organizationSlug', installPayload.organization.slug),
      headers: {
        cookie: `${compartmentSessionCookieName}=${browserSession.sessionToken}`,
      },
    });
    expect(browserUsersResponse.statusCode).toBe(302);
    expect(browserUsersResponse.headers.location).toBe(browserLoginPathname);
  });

  it('preserves stored OIDC provider trust settings during partial provider updates', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);
    await createStoredSsoOidcProvider('sop_partial', installPayload.organization.id);
    const browserSession: StoredBrowserSession = await createOrganizationMemberOidcSession({
      email: 'oidc-partial@example.com',
      installPayload,
      oidcProviderId: 'sop_partial',
      principalId: 'prn_oidc_partial',
      sessionId: 'ses_oidc_partial',
      sessionToken: 'oidc-partial-session-token',
    });
    await createStoredAppAccessSession('aps_oidc_partial', browserSession.sessionId);

    const updateProviderResponse: LightMyRequestResponse = await app.inject({
      headers: buildOrganizationAuthorizationHeaders(installPayload.sessionToken),
      method: 'PATCH',
      payload: {
        buttonText: 'Continue with Single sign-on',
      },
      url: '/v1/sso/oidc/providers/sop_partial',
    });
    expect(updateProviderResponse.statusCode).toBe(200);

    expect(await readStoredSsoOidcProvider('sop_partial')).toEqual({
      buttonText: 'Continue with Single sign-on',
      key: 'sop-partial',
    });
    expect((await readStoredAuthSession(browserSession.sessionId)).revokedAt).toBeNull();
    expect((await readStoredAppAccessSession('aps_oidc_partial')).revokedAt).toBeNull();
    expect(appAccessEdgeServiceMocks.invalidateEdgeAppAccessSessions).not.toHaveBeenCalled();
  });

  it('lists organizations for the authenticated principal', async (): Promise<void> => {
    const installResponse: LightMyRequestResponse = await app.inject({
      method: 'POST',
      url: '/v1/install',
      payload: {
        adminPassword: 'supersecretpassword',
        organizationName: 'Acme Dev',
        organizationSlug: 'acme-dev',
        adminEmail: 'admin@example.com',
        baseDomain: 'localhost',
      },
    });
    const installPayload: InstallResponse = installResponseSchema.parse(installResponse.json());
    const orgListResponse: LightMyRequestResponse = await app.inject({
      method: 'GET',
      url: '/v1/orgs',
      headers: {
        authorization: `Bearer ${installPayload.sessionToken}`,
      },
    });
    expect(orgListResponse.statusCode).toBe(200);
    expect(organizationListResponseSchema.parse(orgListResponse.json()).organizations).toHaveLength(1);
  });
  it('creates additional organizations for authenticated organization admins', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);

    const createOrganizationHttpResponse: LightMyRequestResponse = await app.inject({
      headers: {
        authorization: `Bearer ${installPayload.sessionToken}`,
      },
      method: 'POST',
      payload: {
        name: 'Beta Dev',
        slug: 'beta-dev',
      },
      url: '/v1/organizations',
    });

    expect(createOrganizationHttpResponse.statusCode).toBe(200);
    const createOrganizationPayload: CreateOrganizationResponse = createOrganizationResponseSchema.parse(
      createOrganizationHttpResponse.json(),
    );
    expect(createOrganizationPayload.organization.slug).toBe('beta-dev');

    const orgListResponse: LightMyRequestResponse = await app.inject({
      headers: {
        authorization: `Bearer ${installPayload.sessionToken}`,
      },
      method: 'GET',
      url: '/v1/orgs',
    });
    const storedOperations: StoredOperationRow[] = await db.select().from(operations);

    expect(organizationListResponseSchema.parse(orgListResponse.json()).organizations).toHaveLength(2);
    expect(storedOperations.map((operation: StoredOperationRow): string => operation.type)).toContain(
      'organization.create',
    );
  });
  it('rejects duplicate organization slugs', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);

    const duplicateOrganizationResponse: LightMyRequestResponse = await app.inject({
      headers: {
        authorization: `Bearer ${installPayload.sessionToken}`,
      },
      method: 'POST',
      payload: {
        name: 'Acme Dev Again',
        slug: 'acme-dev',
      },
      url: '/v1/organizations',
    });

    expect(duplicateOrganizationResponse.statusCode).toBe(409);
    expect(errorResponseSchema.parse(duplicateOrganizationResponse.json()).error.code).toBe('organization_slug_taken');
  });
  it('rejects organization creation when the provided name cannot produce a slug', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);

    const createOrganizationHttpResponse: LightMyRequestResponse = await app.inject({
      headers: {
        authorization: `Bearer ${installPayload.sessionToken}`,
      },
      method: 'POST',
      payload: {
        name: '!!!',
      },
      url: '/v1/organizations',
    });

    expect(createOrganizationHttpResponse.statusCode).toBe(400);
    expect(errorResponseSchema.parse(createOrganizationHttpResponse.json()).error.code).toBe(
      'invalid_organization_slug',
    );
  });
  it('rejects organization creation with an invalid explicit slug at the request boundary', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);

    const createOrganizationHttpResponse: LightMyRequestResponse = await app.inject({
      headers: {
        authorization: `Bearer ${installPayload.sessionToken}`,
      },
      method: 'POST',
      payload: {
        name: 'Gamma Dev',
        slug: 'Hello World',
      },
      url: '/v1/organizations',
    });

    expect(createOrganizationHttpResponse.statusCode).toBe(400);
    expect(errorResponseSchema.parse(createOrganizationHttpResponse.json()).error.code).toBe(
      'invalid_create_organization_request',
    );
  });
  it('rejects organization creation for authenticated non-admin members', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);
    const viewerSessionToken: string = await createOrganizationMemberSession({
      db,
      email: 'viewer@example.com',
      organizationId: installPayload.organization.id,
      principalId: 'prn_viewer',
      role: 'viewer',
      sessionId: 'ses_viewer',
      sessionSecret: defaultApiConfig.sessionSecret,
      sessionToken: 'viewer-session-token',
    });

    const createOrganizationHttpResponse: LightMyRequestResponse = await app.inject({
      headers: {
        authorization: `Bearer ${viewerSessionToken}`,
      },
      method: 'POST',
      payload: {
        name: 'Gamma Dev',
        slug: 'gamma-dev',
      },
      url: '/v1/organizations',
    });

    expect(createOrganizationHttpResponse.statusCode).toBe(403);
    expect(errorResponseSchema.parse(createOrganizationHttpResponse.json()).error.code).toBe('forbidden');
  });
  it('registers nodes through the runtime-control-authenticated register endpoint', async (): Promise<void> => {
    const registrationResponse: LightMyRequestResponse = await injectNodeRegistrationRequest(app, {
      nodeName: 'local-node',
      nodeSocketPath: defaultApiConfig.nodeAgentSocketPath,
      nodeVersion: '0.1.0',
    });
    expect(registrationResponse.statusCode).toBe(200);
    expect(nodeRegistrationResponseSchema.parse(registrationResponse.json()).node.name).toBe('local-node');
  });
  it('rejects node registration for a socket path outside the configured node agent socket', async (): Promise<void> => {
    const registrationResponse: LightMyRequestResponse = await injectNodeRegistrationRequest(app, {
      nodeName: 'local-node',
      nodeSocketPath: '/tmp/compartment/api-test/api/system-api.sock',
      nodeVersion: '0.1.0',
    });
    expect(registrationResponse.statusCode).toBe(400);
    expect(errorResponseSchema.parse(registrationResponse.json()).error.code).toBe('invalid_node_registration_request');
  });
  it('rejects node registration requests without the runtime control token', async (): Promise<void> => {
    const registrationResponse: LightMyRequestResponse = await injectNodeRegistrationRequest(
      app,
      {
        nodeName: 'local-node',
        nodeSocketPath: '/tmp/compartment/api-test/node/deploy-submission.sock',
        nodeVersion: '0.1.0',
      },
      null,
    );
    expect(registrationResponse.statusCode).toBe(401);
    expect(errorResponseSchema.parse(registrationResponse.json()).error.code).toBe('internal_worker_unauthorized');
  });
  it('rejects source upload creation requests that are not multipart uploads', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);

    const sourceUploadResponse: LightMyRequestResponse = await app.inject({
      method: 'POST',
      url: '/v1/source-uploads',
      payload: JSON.stringify({ sourceArchive: 'invalid' }),
      headers: {
        authorization: `Bearer ${installPayload.sessionToken}`,
        'content-type': 'application/json',
        [compartmentCurrentOrganizationHeaderName]: 'acme-dev',
      },
    });

    expect(sourceUploadResponse.statusCode).toBe(400);
    expect(errorResponseSchema.parse(sourceUploadResponse.json()).error.code).toBe('invalid_source_upload_request');

    expect(await db.select().from(sourceUploads)).toHaveLength(0);
  });
  it('rejects trailing multipart fields after a source upload archive and cleans up the hidden upload', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);
    const multipartRequest: MultipartRequest = buildMultipartRequest([
      createMultipartFilePart(
        'sourceArchive',
        await createSourceArchive({
          'compartment.yml': 'name: smoke-web\nservices:\n  web: .\n',
          'package.json': '{"name":"root"}\n',
          'services/web/package.json': '{"name":"web"}\n',
        }),
        'source.tgz',
        'application/gzip',
      ),
      createMultipartFieldPart('descriptor', '{"unexpected":true}'),
    ]);

    const sourceUploadResponse: LightMyRequestResponse = await app.inject({
      method: 'POST',
      url: '/v1/source-uploads',
      payload: multipartRequest.payload,
      headers: {
        authorization: `Bearer ${installPayload.sessionToken}`,
        'content-type': multipartRequest.contentType,
        [compartmentCurrentOrganizationHeaderName]: 'acme-dev',
      },
    });

    expect(sourceUploadResponse.statusCode).toBe(400);
    expect(errorResponseSchema.parse(sourceUploadResponse.json()).error.code).toBe('invalid_source_upload_request');
    expect(await db.select().from(sourceUploads)).toHaveLength(0);
  });
  it('rejects malformed gzip-compressed source upload payloads', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);

    const sourceUploadResponse: LightMyRequestResponse = await injectSourceUploadRequest(
      app,
      installPayload.sessionToken,
      'acme-dev',
      Buffer.from('not-a-gzip', 'utf8'),
    );

    expect(sourceUploadResponse.statusCode).toBe(400);
    expect(errorResponseSchema.parse(sourceUploadResponse.json()).error.code).toBe('invalid_source_upload');
    expect(await db.select().from(sourceUploads)).toHaveLength(0);
  });
  it('rejects source upload creation for invited human members', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);
    const invitedSessionToken: string = await createOrganizationMemberSession({
      active: false,
      db,
      email: 'invited-deployer@example.com',
      organizationId: installPayload.organization.id,
      principalId: 'prn_invited_deployer',
      role: 'deployer',
      sessionId: 'ses_invited_deployer',
      sessionSecret: defaultApiConfig.sessionSecret,
      sessionToken: 'invited-deployer-session-token',
    });
    const multipartRequest: MultipartRequest = buildMultipartRequest([
      createMultipartFilePart(
        'sourceArchive',
        await createSourceArchive({
          'compartment.yml': 'name: smoke-web\nservices:\n  web: .\n',
          'package.json': '{"name":"root"}\n',
          'services/web/package.json': '{"name":"web"}\n',
        }),
        'source.tgz',
        'application/gzip',
      ),
    ]);

    const sourceUploadResponse: LightMyRequestResponse = await app.inject({
      method: 'POST',
      url: '/v1/source-uploads',
      payload: multipartRequest.payload,
      headers: {
        authorization: `Bearer ${invitedSessionToken}`,
        'content-type': multipartRequest.contentType,
        [compartmentCurrentOrganizationHeaderName]: 'acme-dev',
      },
    });

    expect(sourceUploadResponse.statusCode).toBe(403);
    expect(errorResponseSchema.parse(sourceUploadResponse.json()).error.code).toBe('forbidden');
    expect(await db.select().from(sourceUploads)).toHaveLength(0);
  });
  it('rejects multipart deployment submissions', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);
    const multipartRequest: MultipartRequest = buildMultipartRequest([
      createMultipartFilePart(
        'sourceArchive',
        await createSourceArchive({
          'compartment.yml': 'name: smoke-web\nservices:\n  web: .\n',
          'package.json': '{"name":"root"}\n',
          'services/web/package.json': '{"name":"web"}\n',
        }),
        'source.tgz',
        'application/gzip',
      ),
      createMultipartFieldPart('descriptor', JSON.stringify({ name: 'smoke-web', services: { web: '.' } })),
    ]);

    const deployResponse: LightMyRequestResponse = await app.inject({
      method: 'POST',
      url: '/v1/deployments',
      payload: multipartRequest.payload,
      headers: {
        authorization: `Bearer ${installPayload.sessionToken}`,
        'content-type': multipartRequest.contentType,
        [compartmentCurrentOrganizationHeaderName]: 'acme-dev',
      },
    });

    expect(deployResponse.statusCode).toBe(400);
    expect(errorResponseSchema.parse(deployResponse.json()).error.code).toBe('invalid_deploy_request');
    expect(await db.select().from(deployments)).toHaveLength(0);
    expect(await db.select().from(sourceUploads)).toHaveLength(0);
  });
  it('creates deployments from a previously uploaded source archive', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);
    await registerLocalNode(app);
    const sourceUpload: SourceUploadSummary = await createUploadedSourceArchive(
      app,
      installPayload.sessionToken,
      'acme-dev',
    );

    const deployResponse: LightMyRequestResponse = await injectJsonDeployRequest(
      app,
      installPayload.sessionToken,
      'acme-dev',
      {
        sourceUploadId: sourceUpload.id,
      },
    );

    expect(deployResponse.statusCode).toBe(200);
    const deployPayload: DeployResponse = deployResponseSchema.parse(deployResponse.json());
    const deployment: DeploymentSummary = requireDeployResponseDeployment(deployPayload);
    const storedBuildArtifact: (typeof buildArtifacts.$inferSelect)[] = await db.select().from(buildArtifacts);
    const storedSourceUploads: (typeof sourceUploads.$inferSelect)[] = await db
      .select()
      .from(sourceUploads)
      .where(eq(sourceUploads.id, sourceUpload.id));

    expect(deployment.id).not.toHaveLength(0);
    expect(storedBuildArtifact).toHaveLength(1);
    expect(storedBuildArtifact[0]?.sourceUploadId).toBe(sourceUpload.id);
    expect(storedSourceUploads[0]?.consumedAt).not.toBeNull();
  });
  it('auto-generates postgres preset passwords before resolving resource outputs', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);
    await registerLocalNode(app);
    queueIntegrationNodeAgentResponse({
      containerId: 'resource_container_db',
      hostname: 'db.production.smoke-web.resource.internal',
      status: 'running',
    });
    await setVariable(app, installPayload.sessionToken, 'acme-dev', {
      fromResource: 'db.connection-url',
      keyName: 'DATABASE_URL',
      projectName: 'smoke-web',
      serviceName: 'api',
    });

    const deployResponse: LightMyRequestResponse = await injectDeployRequest(
      app,
      installPayload.sessionToken,
      'acme-dev',
      {
        descriptor: createPostgresPresetDeployDescriptor(),
        sourceArchive: await createPostgresPresetDeploySourceArchive(),
      },
    );

    expect(deployResponse.statusCode, deployResponse.body).toBe(200);
    const resourceRequest: ResourceRequestInput = JSON.parse(
      readIntegrationNodeAgentRequestBody(0),
    ) as ResourceRequestInput;
    const generatedPassword: string | undefined = resourceRequest.definition.env.find(
      (env: ResourceRequestEnvInput): boolean => env.keyName === postgresPresetPasswordEnvName,
    )?.value;
    expect(generatedPassword).toMatch(/^[0-9a-f]{48}$/u);

    const variableRows: (typeof environmentVariableValues.$inferSelect)[] = await db
      .select()
      .from(environmentVariableValues);
    expect(variableRows).toEqual([
      expect.objectContaining({
        keyName: postgresPresetPasswordEnvName,
        projectServiceId: null,
        sensitivity: 'sensitive',
        targetResourceName: 'db',
      }),
    ]);
    expect(JSON.stringify(variableRows)).not.toContain(generatedPassword);

    const claimedDeployment: WorkerClaimedDeployment = requireClaimedDeployment(await claimNextQueuedDeployment(app));
    expect(claimedDeployment.runtimeEnv.DATABASE_URL).toBe(
      `postgres://app:${generatedPassword}@db.production.smoke-web.resource.internal:5432/app`,
    );

    const listResponse: LightMyRequestResponse = await app.inject({
      headers: buildOrganizationAuthorizationHeaders(installPayload.sessionToken),
      method: 'GET',
      url: '/v1/resources?projectName=smoke-web',
    });
    expect(listResponse.statusCode).toBe(200);
    expect(JSON.stringify(resourceListResponseSchema.parse(listResponse.json()))).not.toContain(generatedPassword);

    const outputListResponse: LightMyRequestResponse = await app.inject({
      headers: buildOrganizationAuthorizationHeaders(installPayload.sessionToken),
      method: 'GET',
      url: '/v1/resources/db/outputs?projectName=smoke-web',
    });
    expect(outputListResponse.statusCode).toBe(200);
    const outputListPayload: ResourceOutputListResponse = resourceOutputListResponseSchema.parse(
      outputListResponse.json(),
    );
    expect(outputListPayload.outputs).toContainEqual(
      expect.objectContaining({
        name: 'connection-url',
        value: null,
        valueHidden: true,
      }),
    );
    expect(JSON.stringify(outputListPayload)).not.toContain(generatedPassword);
  });
  it('preserves existing postgres preset passwords during resource reconciliation', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);
    await registerLocalNode(app);
    queueIntegrationNodeAgentResponse({
      containerId: 'resource_container_db',
      hostname: 'db.production.smoke-web.resource.internal',
      status: 'running',
    });
    await setVariable(app, installPayload.sessionToken, 'acme-dev', {
      keyName: postgresPresetPasswordEnvName,
      projectName: 'smoke-web',
      resourceName: 'db',
      sensitivity: 'sensitive',
      value: 'custom-secret-password',
    });

    const deployResponse: LightMyRequestResponse = await injectDeployRequest(
      app,
      installPayload.sessionToken,
      'acme-dev',
      {
        descriptor: createPostgresPresetDeployDescriptor(),
        sourceArchive: await createPostgresPresetDeploySourceArchive(),
      },
    );

    expect(deployResponse.statusCode, deployResponse.body).toBe(200);
    expect(readIntegrationNodeAgentRequestBody(0)).toContain('custom-secret-password');
    expect(await db.select().from(environmentVariableValues)).toHaveLength(1);
  });
  it('does not auto-generate passwords for full postgres resource configs', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);
    await registerLocalNode(app);
    queueIntegrationNodeAgentResponse({
      containerId: 'resource_container_db',
      hostname: 'db.production.smoke-web.resource.internal',
      status: 'running',
    });

    const deployResponse: LightMyRequestResponse = await injectDeployRequest(
      app,
      installPayload.sessionToken,
      'acme-dev',
      {
        descriptor: createResourceDeployDescriptor(),
        sourceArchive: await createResourceDeploySourceArchive(),
      },
    );

    expect(deployResponse.statusCode, deployResponse.body).toBe(200);
    expect(readIntegrationNodeAgentRequestBody(0)).not.toContain(postgresPresetPasswordEnvName);
    expect(await db.select().from(environmentVariableValues)).toHaveLength(0);
  });
  it('reconciles YAML resources before queueing deployments and exposes resource routes without secret values', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);
    await registerLocalNode(app);
    queueIntegrationNodeAgentResponse({
      containerId: 'resource_container_123',
      hostname: 'postgres.production.smoke-web.resource.internal',
      status: 'running',
    });
    await setPostgresPasswordVariable(installPayload);

    const deployResponse: LightMyRequestResponse = await injectDeployRequest(
      app,
      installPayload.sessionToken,
      'acme-dev',
      {
        descriptor: createResourceDeployDescriptor(),
        sourceArchive: await createResourceDeploySourceArchive(),
      },
    );

    expect(deployResponse.statusCode, deployResponse.body).toBe(200);
    const deployPayload: DeployResponse = deployResponseSchema.parse(deployResponse.json());
    expect(deployPayload.resources).toEqual([
      expect.objectContaining({
        containerId: 'resource_container_123',
        hostname: 'postgres.production.smoke-web.resource.internal',
        name: 'postgres',
        status: 'running',
      }),
    ]);
    expect(JSON.stringify(deployPayload.resources)).not.toContain('super-secret-password');
    expect(await db.select().from(projectResources)).toEqual([
      expect.objectContaining({
        containerId: 'resource_container_123',
        image: 'postgres:16',
        name: 'postgres',
        status: 'running',
      }),
    ]);
    expect(await db.select().from(deployments)).toHaveLength(1);
    expect(readIntegrationNodeAgentRequestBody(0)).toContain('super-secret-password');

    const listResponse: LightMyRequestResponse = await app.inject({
      headers: buildOrganizationAuthorizationHeaders(installPayload.sessionToken),
      method: 'GET',
      url: '/v1/resources?projectName=smoke-web',
    });
    expect(listResponse.statusCode).toBe(200);
    expect(resourceListResponseSchema.parse(listResponse.json()).resources).toHaveLength(1);
    const readonlySessionToken: string = await createOrganizationMemberSession({
      db,
      email: 'readonly@example.com',
      organizationId: installPayload.organization.id,
      principalId: 'prn_readonly',
      role: 'readonly',
      sessionId: 'ses_readonly',
      sessionSecret: defaultApiConfig.sessionSecret,
      sessionToken: 'readonly-session-token',
    });

    const readonlyListResponse: LightMyRequestResponse = await app.inject({
      headers: buildOrganizationAuthorizationHeaders(readonlySessionToken),
      method: 'GET',
      url: '/v1/resources?projectName=smoke-web',
    });
    expect(readonlyListResponse.statusCode).toBe(403);
    expect(errorResponseSchema.parse(readonlyListResponse.json()).error.code).toBe('forbidden');

    const readonlyResourceResponse: LightMyRequestResponse = await app.inject({
      headers: buildOrganizationAuthorizationHeaders(readonlySessionToken),
      method: 'GET',
      url: '/v1/resources/postgres?projectName=smoke-web',
    });
    expect(readonlyResourceResponse.statusCode).toBe(403);
    expect(errorResponseSchema.parse(readonlyResourceResponse.json()).error.code).toBe('forbidden');

    const invalidLogsResponse: LightMyRequestResponse = await app.inject({
      headers: buildOrganizationAuthorizationHeaders(installPayload.sessionToken),
      method: 'GET',
      url: '/v1/resources/postgres/logs?projectName=smoke-web&tailLines=10abc',
    });
    expect(invalidLogsResponse.statusCode).toBe(400);

    queueIntegrationNodeAgentResponse({
      lines: [
        {
          message: 'ready',
          resourceName: 'postgres',
          stream: 'stdout',
          timestamp: '2026-04-29T12:00:00.000Z',
        },
      ],
    });
    const logsResponse: LightMyRequestResponse = await app.inject({
      headers: buildOrganizationAuthorizationHeaders(installPayload.sessionToken),
      method: 'GET',
      url: '/v1/resources/postgres/logs?projectName=smoke-web&tailLines=10',
    });
    expect(logsResponse.statusCode, logsResponse.body).toBe(200);

    const readonlyLogsResponse: LightMyRequestResponse = await app.inject({
      headers: buildOrganizationAuthorizationHeaders(readonlySessionToken),
      method: 'GET',
      url: '/v1/resources/postgres/logs?projectName=smoke-web&tailLines=10',
    });
    expect(readonlyLogsResponse.statusCode).toBe(403);
    expect(errorResponseSchema.parse(readonlyLogsResponse.json()).error.code).toBe('forbidden');

    clearIntegrationNodeAgentRequests();
    const intentOnlyDescriptor: CompartmentAuthoredDescriptor = createResourceDeployDescriptor();
    const postgresResource: CompartmentAuthoredResourceConfig = requirePostgresResource(intentOnlyDescriptor);
    postgresResource.readiness = {
      port: 5432,
      timeoutMs: 5_000,
      type: 'tcp',
    };
    const adminPrincipalId: string = await readInstalledAdminPrincipalId(installPayload);
    await reconcileDeclaredResources({
      actorPrincipalId: adminPrincipalId,
      descriptor: intentOnlyDescriptor,
      organizationSlug: installPayload.organization.slug,
    });
    expect(readIntegrationNodeAgentRequests()).toHaveLength(0);
    expect(await db.select().from(projectResources)).toEqual([
      expect.objectContaining({
        hostname: 'postgres.production.smoke-web.resource.internal',
        readinessJson: JSON.stringify({
          port: 5432,
          timeoutMs: 5_000,
          type: 'tcp',
        }),
        restartPolicy: 'unless-stopped',
      }),
    ]);

    clearIntegrationNodeAgentRequests();
    postgresResource.restart = {
      policy: 'no',
    };
    await reconcileDeclaredResources({
      actorPrincipalId: adminPrincipalId,
      descriptor: intentOnlyDescriptor,
      organizationSlug: installPayload.organization.slug,
    });
    expect(readIntegrationNodeAgentRequests()).toHaveLength(1);
    expect(readIntegrationNodeAgentRequests()[0]?.pathname).toBe(nodeResourceRestartPolicyPathname);
    expect(JSON.parse(readIntegrationNodeAgentRequestBody(0))).toEqual({
      containerId: 'resource_container_123',
      environmentName: 'production',
      projectName: 'smoke-web',
      resourceName: 'postgres',
      restart: {
        policy: 'no',
      },
    });
    expect(await db.select().from(projectResources)).toEqual([
      expect.objectContaining({
        readinessJson: JSON.stringify({
          port: 5432,
          timeoutMs: 5_000,
          type: 'tcp',
        }),
        restartPolicy: 'no',
      }),
    ]);

    clearIntegrationNodeAgentRequests();
    queueIntegrationNodeAgentResponse({
      containerId: 'resource_container_123',
      hostname: 'postgres.production.smoke-renamed.resource.internal',
      status: 'running',
    });
    await db.update(projects).set({ name: 'smoke-renamed' }).where(eq(projects.name, 'smoke-web'));
    intentOnlyDescriptor.name = 'smoke-renamed';
    await reconcileDeclaredResources({
      actorPrincipalId: adminPrincipalId,
      descriptor: intentOnlyDescriptor,
      organizationSlug: installPayload.organization.slug,
    });
    expect(readIntegrationNodeAgentRequests()).toHaveLength(1);
    expect(readIntegrationNodeAgentRequests()[0]?.pathname).toBe(nodeResourceReconcilePathname);
    expect(await db.select().from(projectResources)).toEqual([
      expect.objectContaining({
        hostname: 'postgres.production.smoke-renamed.resource.internal',
        restartPolicy: 'no',
      }),
    ]);

    clearIntegrationNodeAgentRequests();
    queueIntegrationNodeAgentResponse({
      containerId: null,
      hostname: 'postgres.production.smoke-renamed.resource.internal',
      status: 'stopped',
    });
    const stopResourceResponse: LightMyRequestResponse = await app.inject({
      headers: buildOrganizationAuthorizationHeaders(installPayload.sessionToken),
      method: 'POST',
      url: '/v1/resources/postgres/stop?projectName=smoke-renamed',
    });
    expect(stopResourceResponse.statusCode, stopResourceResponse.body).toBe(200);
    expect(readIntegrationNodeAgentRequests()[0]?.pathname).toBe(nodeResourceStopPathname);
    expect(JSON.parse(readIntegrationNodeAgentRequestBody(0))).toEqual({
      containerId: 'resource_container_123',
      environmentName: 'production',
      projectName: 'smoke-renamed',
      resourceName: 'postgres',
      volumes: [
        {
          mountPath: '/var/lib/postgresql/data',
          name: 'data',
        },
      ],
    });

    clearIntegrationNodeAgentRequests();
    queueIntegrationNodeAgentResponse({
      containerId: null,
      hostname: 'postgres.production.smoke-renamed.resource.internal',
      status: 'stopped',
    });
    const deleteStoppedResourceResponse: LightMyRequestResponse = await app.inject({
      headers: buildOrganizationAuthorizationHeaders(installPayload.sessionToken),
      method: 'DELETE',
      payload: {
        confirmation: 'delete-resource-data',
        deleteData: true,
      },
      url: '/v1/resources/postgres?projectName=smoke-renamed',
    });
    expect(deleteStoppedResourceResponse.statusCode, deleteStoppedResourceResponse.body).toBe(200);
    expect(readIntegrationNodeAgentRequests()[0]?.pathname).toBe(nodeResourceDeletePathname);
    expect(JSON.parse(readIntegrationNodeAgentRequestBody(0))).toEqual({
      containerId: null,
      deleteData: true,
      environmentName: 'production',
      projectName: 'smoke-renamed',
      resourceName: 'postgres',
      volumes: [
        {
          mountPath: '/var/lib/postgresql/data',
          name: 'data',
        },
      ],
    });
    expect(await db.select().from(projectResources)).toHaveLength(0);
  });
  it('does not persist resource intent or queue app deployments when resource reconciliation fails', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);
    await registerLocalNode(app);
    queueIntegrationNodeAgentError('not ready');
    await setPostgresPasswordVariable(installPayload);

    const deployResponse: LightMyRequestResponse = await injectDeployRequest(
      app,
      installPayload.sessionToken,
      'acme-dev',
      {
        descriptor: createResourceDeployDescriptor(),
        sourceArchive: await createResourceDeploySourceArchive(),
      },
    );

    expect(deployResponse.statusCode, deployResponse.body).toBe(500);
    expect(await db.select().from(projectResources)).toHaveLength(0);
    expect(await db.select().from(deployments)).toHaveLength(0);
    expect(await db.select().from(buildArtifacts)).toHaveLength(0);
  });
  it('rejects invalid first-deploy onboarding sessions before reconciling resources', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);
    await registerLocalNode(app);
    await setPostgresPasswordVariable(installPayload);

    const deployResponse: LightMyRequestResponse = await injectDeployRequest(
      app,
      installPayload.sessionToken,
      'acme-dev',
      {
        descriptor: createResourceDeployDescriptor(),
        onboardingSessionId: 'fdo_missing',
        sourceArchive: await createResourceDeploySourceArchive(),
      },
    );

    expect(deployResponse.statusCode, deployResponse.body).toBe(404);
    expect(errorResponseSchema.parse(deployResponse.json()).error.code).toBe('onboarding_session_not_found');
    expect(readIntegrationNodeAgentRequests()).toHaveLength(0);
    expect(await db.select().from(projectResources)).toHaveLength(0);
    expect(await db.select().from(deployments)).toHaveLength(0);
    expect(await db.select().from(buildArtifacts)).toHaveLength(0);
  });
  it('rejects source-upload deployment submission for invited human members', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);
    await registerLocalNode(app);
    const sourceUpload: SourceUploadSummary = await createUploadedSourceArchive(
      app,
      installPayload.sessionToken,
      'acme-dev',
    );
    const invitedSessionToken: string = await createOrganizationMemberSession({
      active: false,
      db,
      email: 'invited-json@example.com',
      organizationId: installPayload.organization.id,
      principalId: 'prn_invited_json',
      role: 'deployer',
      sessionId: 'ses_invited_json',
      sessionSecret: defaultApiConfig.sessionSecret,
      sessionToken: 'invited-json-session-token',
    });

    const deployResponse: LightMyRequestResponse = await injectJsonDeployRequest(app, invitedSessionToken, 'acme-dev', {
      sourceUploadId: sourceUpload.id,
    });

    expect(deployResponse.statusCode).toBe(403);
    expect(errorResponseSchema.parse(deployResponse.json()).error.code).toBe('forbidden');
    expect(await db.select().from(deployments)).toHaveLength(0);
    expect(
      (await db.select().from(sourceUploads).where(eq(sourceUploads.id, sourceUpload.id)))[0]?.consumedAt,
    ).toBeNull();
  });
  it('rejects json deployment submission when sourceUploadId is missing', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);

    const deployResponse: LightMyRequestResponse = await app.inject({
      headers: {
        authorization: `Bearer ${installPayload.sessionToken}`,
        [compartmentCurrentOrganizationHeaderName]: 'acme-dev',
      },
      method: 'POST',
      payload: {
        descriptor: {
          name: 'smoke-web',
          services: {
            web: '.',
          },
        },
      },
      url: '/v1/deployments',
    });

    expect(deployResponse.statusCode).toBe(400);
    expect(errorResponseSchema.parse(deployResponse.json()).error.code).toBe('invalid_deploy_request');
    expect(await db.select().from(deployments)).toHaveLength(0);
  });
  it('rejects deployment submission when the source upload is missing', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);

    const deployResponse: LightMyRequestResponse = await injectJsonDeployRequest(
      app,
      installPayload.sessionToken,
      'acme-dev',
      {
        sourceUploadId: 'sup_missing',
      },
    );

    expect(deployResponse.statusCode).toBe(404);
    expect(errorResponseSchema.parse(deployResponse.json()).error.code).toBe('source_upload_not_found');
    expect(await db.select().from(deployments)).toHaveLength(0);
  });
  it('rejects deployment submission when the source upload was already consumed', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);
    await registerLocalNode(app);
    const sourceUpload: SourceUploadSummary = await createUploadedSourceArchive(
      app,
      installPayload.sessionToken,
      'acme-dev',
    );

    const firstDeployResponse: LightMyRequestResponse = await injectJsonDeployRequest(
      app,
      installPayload.sessionToken,
      'acme-dev',
      {
        sourceUploadId: sourceUpload.id,
      },
    );
    expect(firstDeployResponse.statusCode).toBe(200);

    const secondDeployResponse: LightMyRequestResponse = await injectJsonDeployRequest(
      app,
      installPayload.sessionToken,
      'acme-dev',
      {
        sourceUploadId: sourceUpload.id,
      },
    );

    expect(secondDeployResponse.statusCode).toBe(409);
    expect(errorResponseSchema.parse(secondDeployResponse.json()).error.code).toBe('source_upload_already_consumed');
  });
  it('allows only one concurrent deployment submission to consume a source upload', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);
    await registerLocalNode(app);
    const sourceUpload: SourceUploadSummary = await createUploadedSourceArchive(
      app,
      installPayload.sessionToken,
      'acme-dev',
    );

    const responses: LightMyRequestResponse[] = await Promise.all([
      injectJsonDeployRequest(app, installPayload.sessionToken, 'acme-dev', {
        sourceUploadId: sourceUpload.id,
      }),
      injectJsonDeployRequest(app, installPayload.sessionToken, 'acme-dev', {
        sourceUploadId: sourceUpload.id,
      }),
    ]);
    const successResponse: LightMyRequestResponse | undefined = responses.find(
      (response: LightMyRequestResponse): boolean => response.statusCode === 200,
    );
    const conflictResponse: LightMyRequestResponse | undefined = responses.find(
      (response: LightMyRequestResponse): boolean => response.statusCode === 409,
    );
    const storedSourceUploads: (typeof sourceUploads.$inferSelect)[] = await db
      .select()
      .from(sourceUploads)
      .where(eq(sourceUploads.id, sourceUpload.id));

    const responseStatusCodes: number[] = responses
      .map((response: LightMyRequestResponse): number => response.statusCode)
      .sort((left: number, right: number): number => left - right);

    expect(responseStatusCodes).toEqual([200, 409]);
    expect(successResponse).toBeDefined();
    expect(conflictResponse).toBeDefined();
    deployResponseSchema.parse(successResponse!.json());
    expect(errorResponseSchema.parse(conflictResponse!.json()).error.code).toBe('source_upload_already_consumed');
    expect(await db.select().from(deployments)).toHaveLength(1);
    expect(await db.select().from(buildArtifacts)).toHaveLength(1);
    expect(storedSourceUploads[0]?.consumedAt).not.toBeNull();
  });
  it('rejects deployment submission when the source upload expired and leaves cleanup to opportunistic expiry passes', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);
    const sourceUpload: SourceUploadSummary = await createUploadedSourceArchive(
      app,
      installPayload.sessionToken,
      'acme-dev',
    );

    await db
      .update(sourceUploads)
      .set({
        expiresAt: new Date('2026-03-01T00:00:00.000Z'),
      })
      .where(eq(sourceUploads.id, sourceUpload.id));

    const deployResponse: LightMyRequestResponse = await injectJsonDeployRequest(
      app,
      installPayload.sessionToken,
      'acme-dev',
      {
        sourceUploadId: sourceUpload.id,
      },
    );

    expect(deployResponse.statusCode).toBe(409);
    expect(errorResponseSchema.parse(deployResponse.json()).error.code).toBe('source_upload_expired');
    expect(await db.select().from(sourceUploads)).toHaveLength(1);
  });
  it('rejects oversized source upload requests with an invalid source upload request error', async (): Promise<void> => {
    const limitedApiConfig: ApiConfig = {
      ...defaultApiConfig,
      sourceArchiveMaxBytes: 64,
      throttle: defaultApiConfig.throttle,
    };

    configureApiRuntimeWithPublicIngress(limitedApiConfig, db);

    try {
      const installPayload: InstallResponse = await installCompartment(app);
      const sourceArchive: Buffer = await createSourceArchive({
        'package.json': '{"name":"root"}\n',
        'services/web/package.json': '{"name":"web"}\n',
      });

      expect(sourceArchive.length).toBeGreaterThan(64);

      const sourceUploadResponse: LightMyRequestResponse = await injectSourceUploadRequest(
        app,
        installPayload.sessionToken,
        'acme-dev',
        sourceArchive,
      );

      expect(sourceUploadResponse.statusCode).toBe(413);
      expect(errorResponseSchema.parse(sourceUploadResponse.json()).error).toEqual({
        code: 'invalid_source_upload_request',
        message: 'Source archive must not exceed 64 bytes.',
      });
      expect(await db.select().from(sourceUploads)).toHaveLength(0);
    } finally {
      configureApiRuntimeWithPublicIngress(defaultApiConfig, db);
    }
  });
});

async function createOrganizationMemberOidcSession(
  input: CreateOrganizationMemberOidcSessionInput,
): Promise<StoredBrowserSession> {
  await db.insert(principals).values({
    email: input.email,
    id: input.principalId,
    type: 'user',
  });
  await db.insert(organizationMemberships).values({
    id: `mem_${input.sessionId}`,
    organizationId: input.installPayload.organization.id,
    principalId: input.principalId,
  });
  await db.insert(authSessions).values({
    authMethodKind: 'oidc',
    expiresAt: new Date('2099-01-01T00:00:00.000Z'),
    id: input.sessionId,
    oidcProviderId: input.oidcProviderId,
    organizationId: input.installPayload.organization.id,
    principalId: input.principalId,
    tokenHash: hashToken(input.sessionToken, defaultApiConfig.sessionSecret),
  });

  return {
    sessionId: input.sessionId,
    sessionToken: input.sessionToken,
  };
}

async function setPostgresPasswordVariable(installPayload: InstallResponse): Promise<void> {
  const payload: SetVariableRequest = {
    keyName: postgresPresetPasswordEnvName,
    projectName: 'smoke-web',
    resourceName: 'postgres',
    value: 'super-secret-password',
  };

  await setVariable(app, installPayload.sessionToken, 'acme-dev', payload);
}

function requirePostgresResource(descriptor: CompartmentAuthoredDescriptor): CompartmentAuthoredResourceConfig {
  const postgresResource: CompartmentAuthoredResourceConfig | undefined = descriptor.resources?.postgres;
  if (postgresResource === undefined) {
    throw new Error('Expected postgres resource descriptor.');
  }

  return postgresResource;
}

async function readInstalledAdminPrincipalId(installPayload: InstallResponse): Promise<string> {
  const [adminPrincipal] = await db
    .select()
    .from(principals)
    .where(eq(principals.email, installPayload.adminEmail))
    .limit(1);
  if (adminPrincipal === undefined) {
    throw new Error('Expected installed admin principal.');
  }

  return adminPrincipal.id;
}

function createResourceDeployDescriptor(): CompartmentAuthoredDescriptor {
  return {
    name: 'smoke-web',
    resources: {
      postgres: {
        env: {
          POSTGRES_DB: 'app',
        },
        image: 'postgres:16',
        ports: [5432],
        readiness: {
          port: 5432,
          type: 'tcp',
        },
        volumes: {
          data: '/var/lib/postgresql/data',
        },
      },
    },
    services: {
      web: './services/web',
    },
  };
}

function createPostgresPresetDeployDescriptor(): CompartmentAuthoredDescriptorInput {
  return {
    name: 'smoke-web',
    resources: {
      db: {
        preset: 'postgres',
      },
    },
    services: {
      api: './services/api',
    },
  };
}

async function createPostgresPresetDeploySourceArchive(): Promise<Buffer> {
  return await createSourceArchive(
    {
      'compartment.yml': 'name: smoke-web\nservices:\n  api: ./services/api\nresources:\n  db:\n    preset: postgres\n',
      'services/api/package.json': '{"name":"api"}\n',
    },
    {
      descriptorDirectoryRelativePath: '.',
      version: 1,
    },
  );
}

async function createResourceDeploySourceArchive(): Promise<Buffer> {
  return await createSourceArchive(
    {
      'compartment.yml': 'name: smoke-web\nservices:\n  web: ./services/web\n',
      'services/web/package.json': '{"name":"web"}\n',
    },
    {
      descriptorDirectoryRelativePath: '.',
      version: 1,
    },
  );
}

async function createStoredSsoOidcProvider(providerId: string, organizationId: string): Promise<void> {
  await createStoredSsoOidcProviderFixture({
    db,
    organizationId,
    providerId,
    variablesMasterKey: defaultApiConfig.variablesMasterKey,
  });
}

async function createStoredAppAccessSession(appSessionId: string, authSessionId: string): Promise<void> {
  await createStoredAppAccessSessionFixture(db, defaultApiConfig.sessionSecret, appSessionId, authSessionId);
}

async function readStoredAuthSession(sessionId: string): Promise<{ revokedAt: Date | null }> {
  return await readStoredAuthSessionFixture(db, sessionId);
}

async function readStoredAppAccessSession(appSessionId: string): Promise<{ revokedAt: Date | null }> {
  return await readStoredAppAccessSessionFixture(db, appSessionId);
}

async function readStoredSsoOidcProvider(providerId: string): Promise<{ buttonText: string; key: string }> {
  return await readStoredSsoOidcProviderFixture(db, providerId);
}
