import {
  deployResponseSchema,
  errorResponseSchema,
  sourceUploadSummarySchema,
  type InstallResponse,
  type SourceUploadSummary,
} from '@compartment/contracts';
import { and, eq } from 'drizzle-orm';
import type { LightMyRequestResponse } from 'fastify';
import type { Pool } from 'pg';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { ApiApp } from '../src/app.types';
import { createDatabase, createDatabasePool, type Database } from '../src/db/client';
import {
  accessAssignments,
  accessRoles,
  auditEvents,
  buildArtifacts,
  deployments,
  projects,
  sourceUploads,
} from '../src/db/schema';
import { createOrganizationMemberSession } from './api-auth-session-test.fixtures';
import {
  createUploadedSourceArchive,
  injectJsonDeployRequest,
  injectSourceUploadRequest,
  installCompartment,
} from './api-integration.harness';
import {
  cleanupApiIntegrationRuntime,
  cleanupApiIntegrationTempDirectory,
  configureApiRuntimeWithPublicIngress,
  createApiIntegrationApps,
  createApiIntegrationTestContext,
  resetApiIntegrationTempDirectory,
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

interface CreateProjectDeployerSessionInput {
  assignmentId: string;
  email: string;
  organizationId: string;
  principalId: string;
  projectId: string;
  sessionId: string;
  sessionToken: string;
}

interface AssignProjectDeployerInput {
  assignmentId: string;
  organizationId: string;
  principalId: string;
  projectId: string;
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

const {
  apiConfig: defaultApiConfig,
  databaseUrl: apiIntegrationDatabaseUrl,
  testTempDirectory,
} = createApiIntegrationTestContext(
  'api_integration_source_upload_ownership',
  'api-integration-source-upload-ownership',
);
let pool!: Pool;
let db!: Database;
let app!: ApiApp;
let systemApp!: ApiApp;
let hasInitializedApiIntegrationRuntime: boolean = false;

describe('API source upload ownership integration', (): void => {
  useApiDatabaseTestHarness(apiIntegrationDatabaseUrl);

  beforeEach(async (): Promise<void> => {
    resetExternalServiceMocks();
    await resetApiIntegrationTempDirectory(testTempDirectory);
    pool = createDatabasePool(apiIntegrationDatabaseUrl);
    db = createDatabase(pool);
    ({ app, systemApp } = await createApiIntegrationApps(defaultApiConfig, db, pool));
    configureApiRuntimeWithPublicIngress(defaultApiConfig, db);
    hasInitializedApiIntegrationRuntime = true;
  });

  afterAll(async (): Promise<void> => {
    await cleanupApiIntegrationTempDirectory(testTempDirectory);
  });

  afterEach(async (): Promise<void> => {
    vi.unstubAllGlobals();
    if (!hasInitializedApiIntegrationRuntime) {
      return;
    }

    hasInitializedApiIntegrationRuntime = false;
    await cleanupApiIntegrationRuntime(app, systemApp, pool);
  });

  it('rejects unscoped upload creation for project-scoped deployers', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);
    await createProject('prj_smoke_web', 'smoke-web', installPayload.organization.id);
    const deployerSessionToken: string = await createProjectDeployerSession({
      assignmentId: 'asg_source_upload_project_deployer',
      email: 'source-upload-project-deployer@example.com',
      organizationId: installPayload.organization.id,
      principalId: 'prn_source_upload_project_deployer',
      projectId: 'prj_smoke_web',
      sessionId: 'ses_source_upload_project_deployer',
      sessionToken: 'source-upload-project-deployer-session-token',
    });

    const sourceUploadResponse: LightMyRequestResponse = await injectSourceUploadRequest(
      app,
      deployerSessionToken,
      'acme-dev',
    );

    expect(sourceUploadResponse.statusCode).toBe(403);
    expect(errorResponseSchema.parse(sourceUploadResponse.json()).error.code).toBe('forbidden');
    expect(await db.select().from(sourceUploads)).toHaveLength(0);
  });

  it('creates project-scoped uploads for project deployers and audits the project scope', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);
    await createProject('prj_smoke_web', 'smoke-web', installPayload.organization.id);
    const deployerSessionToken: string = await createProjectDeployerSession({
      assignmentId: 'asg_source_upload_project_deployer',
      email: 'source-upload-project-deployer@example.com',
      organizationId: installPayload.organization.id,
      principalId: 'prn_source_upload_project_deployer',
      projectId: 'prj_smoke_web',
      sessionId: 'ses_source_upload_project_deployer',
      sessionToken: 'source-upload-project-deployer-session-token',
    });

    const sourceUploadResponse: LightMyRequestResponse = await injectSourceUploadRequest(
      app,
      deployerSessionToken,
      'acme-dev',
      {
        projectName: 'smoke-web',
      },
    );

    expect(sourceUploadResponse.statusCode).toBe(200);
    const sourceUpload: SourceUploadSummary = sourceUploadSummarySchema.parse(sourceUploadResponse.json());
    const [sourceUploadRow] = await db.select().from(sourceUploads).where(eq(sourceUploads.id, sourceUpload.id));
    expect(sourceUploadRow?.projectId).toBe('prj_smoke_web');
    expect(sourceUploadRow?.environmentId).toBeNull();
    expect(sourceUploadRow?.projectServiceId).toBeNull();
    expect(await readSourceUploadAuditProjectIds(sourceUpload.id)).toEqual(['prj_smoke_web']);
  });

  it('keeps project scope when the target deploy environment does not exist yet', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);
    await createProject('prj_smoke_web', 'smoke-web', installPayload.organization.id);
    const deployerSessionToken: string = await createProjectDeployerSession({
      assignmentId: 'asg_source_upload_project_deployer',
      email: 'source-upload-project-deployer@example.com',
      organizationId: installPayload.organization.id,
      principalId: 'prn_source_upload_project_deployer',
      projectId: 'prj_smoke_web',
      sessionId: 'ses_source_upload_project_deployer',
      sessionToken: 'source-upload-project-deployer-session-token',
    });

    const sourceUploadResponse: LightMyRequestResponse = await injectSourceUploadRequest(
      app,
      deployerSessionToken,
      'acme-dev',
      {
        environmentName: 'preview',
        projectName: 'smoke-web',
      },
    );

    expect(sourceUploadResponse.statusCode).toBe(200);
    const sourceUpload: SourceUploadSummary = sourceUploadSummarySchema.parse(sourceUploadResponse.json());
    const [sourceUploadRow] = await db.select().from(sourceUploads).where(eq(sourceUploads.id, sourceUpload.id));
    expect(sourceUploadRow?.projectId).toBe('prj_smoke_web');
    expect(sourceUploadRow?.environmentId).toBeNull();
    expect(sourceUploadRow?.projectServiceId).toBeNull();
    expect(await readSourceUploadAuditProjectIds(sourceUpload.id)).toEqual(['prj_smoke_web']);
  });

  it('rejects scoped upload consumption from another project and principal', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);
    await createProject('prj_smoke_web', 'smoke-web', installPayload.organization.id);
    await createProject('prj_other_web', 'other-web', installPayload.organization.id);
    const ownerSessionToken: string = await createProjectDeployerSession({
      assignmentId: 'asg_source_upload_owner_smoke',
      email: 'source-upload-owner@example.com',
      organizationId: installPayload.organization.id,
      principalId: 'prn_source_upload_owner',
      projectId: 'prj_smoke_web',
      sessionId: 'ses_source_upload_owner',
      sessionToken: 'source-upload-owner-session-token',
    });
    await assignProjectDeployer({
      assignmentId: 'asg_source_upload_owner_other',
      organizationId: installPayload.organization.id,
      principalId: 'prn_source_upload_owner',
      projectId: 'prj_other_web',
    });
    const otherPrincipalSessionToken: string = await createProjectDeployerSession({
      assignmentId: 'asg_source_upload_other_principal',
      email: 'source-upload-other-principal@example.com',
      organizationId: installPayload.organization.id,
      principalId: 'prn_source_upload_other_principal',
      projectId: 'prj_smoke_web',
      sessionId: 'ses_source_upload_other_principal',
      sessionToken: 'source-upload-other-principal-session-token',
    });
    const sourceUploadResponse: LightMyRequestResponse = await injectSourceUploadRequest(
      app,
      ownerSessionToken,
      'acme-dev',
      {
        projectName: 'smoke-web',
      },
    );

    expect(sourceUploadResponse.statusCode).toBe(200);
    const sourceUpload: SourceUploadSummary = sourceUploadSummarySchema.parse(sourceUploadResponse.json());
    const otherProjectDeployResponse: LightMyRequestResponse = await injectJsonDeployRequest(
      app,
      ownerSessionToken,
      'acme-dev',
      {
        projectName: 'other-web',
        sourceUploadId: sourceUpload.id,
      },
    );
    const otherPrincipalDeployResponse: LightMyRequestResponse = await deployFromSourceUpload(
      otherPrincipalSessionToken,
      'acme-dev',
      sourceUpload.id,
    );

    expectForbiddenDeployment(otherProjectDeployResponse);
    expectForbiddenDeployment(otherPrincipalDeployResponse);
    expect(await db.select().from(deployments)).toHaveLength(0);
    expect(await db.select().from(buildArtifacts)).toHaveLength(0);
    expect(
      (await db.select().from(sourceUploads).where(eq(sourceUploads.id, sourceUpload.id)))[0]?.consumedAt,
    ).toBeNull();
  });

  it('rejects an existing source upload from other organization members during deployment submission', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);
    const sourceUpload: SourceUploadSummary = await createUploadedSourceArchive(
      app,
      installPayload.sessionToken,
      'acme-dev',
    );
    const deployerSessionToken: string = await createDeployerSession(installPayload);

    await expectSourceUploadConsumptionForbidden(deployerSessionToken, 'acme-dev', sourceUpload.id);

    const ownerDeployResponse: LightMyRequestResponse = await deployFromSourceUpload(
      installPayload.sessionToken,
      'acme-dev',
      sourceUpload.id,
    );
    expect(ownerDeployResponse.statusCode).toBe(200);
    deployResponseSchema.parse(ownerDeployResponse.json());
  });

  it('hides an existing source upload from the same principal in another organization', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);
    const sourceUpload: SourceUploadSummary = await createUploadedSourceArchive(
      app,
      installPayload.sessionToken,
      'acme-dev',
    );
    await createOrganization(installPayload.sessionToken, 'Beta Dev', 'beta-dev');

    await expectSourceUploadConsumptionHidden(installPayload.sessionToken, 'beta-dev', sourceUpload.id);

    const ownerDeployResponse: LightMyRequestResponse = await deployFromSourceUpload(
      installPayload.sessionToken,
      'acme-dev',
      sourceUpload.id,
    );
    expect(ownerDeployResponse.statusCode).toBe(200);
    deployResponseSchema.parse(ownerDeployResponse.json());
  });
});

function resetExternalServiceMocks(): void {
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
}

async function createDeployerSession(installPayload: InstallResponse): Promise<string> {
  return await createOrganizationMemberSession({
    db,
    email: 'source-upload-deployer@example.com',
    organizationId: installPayload.organization.id,
    principalId: 'prn_source_upload_deployer',
    role: 'deployer',
    sessionId: 'ses_source_upload_deployer',
    sessionSecret: defaultApiConfig.sessionSecret,
    sessionToken: 'source-upload-deployer-session-token',
  });
}

async function createProject(id: string, name: string, organizationId: string): Promise<void> {
  await db.insert(projects).values({
    id,
    name,
    organizationId,
    updatedAt: new Date('2026-05-23T00:00:00.000Z'),
  });
}

async function createProjectDeployerSession(input: CreateProjectDeployerSessionInput): Promise<string> {
  const sessionToken: string = await createOrganizationMemberSession({
    assignRole: false,
    db,
    email: input.email,
    organizationId: input.organizationId,
    principalId: input.principalId,
    role: 'deployer',
    sessionId: input.sessionId,
    sessionSecret: defaultApiConfig.sessionSecret,
    sessionToken: input.sessionToken,
  });
  await assignProjectDeployer(input);

  return sessionToken;
}

async function assignProjectDeployer(input: AssignProjectDeployerInput): Promise<void> {
  await db.insert(accessAssignments).values({
    id: input.assignmentId,
    organizationId: input.organizationId,
    roleId: await readRoleId(input.organizationId, 'deployer'),
    scopeId: input.projectId,
    scopeType: 'project',
    subjectId: input.principalId,
    subjectType: 'principal',
  });
}

async function readRoleId(organizationId: string, roleName: string): Promise<string> {
  const [role] = await db
    .select({ id: accessRoles.id })
    .from(accessRoles)
    .where(and(eq(accessRoles.organizationId, organizationId), eq(accessRoles.name, roleName)));
  if (role === undefined) {
    throw new Error(`Expected ${roleName} role.`);
  }

  return role.id;
}

async function readSourceUploadAuditProjectIds(sourceUploadId: string): Promise<(string | null)[]> {
  const rows: { projectId: string | null }[] = await db
    .select({ projectId: auditEvents.projectId })
    .from(auditEvents)
    .where(and(eq(auditEvents.eventType, 'source.upload.created'), eq(auditEvents.targetId, sourceUploadId)));

  return rows.map((row: { projectId: string | null }): string | null => row.projectId);
}

async function expectSourceUploadConsumptionForbidden(
  sessionToken: string,
  organizationSlug: string,
  sourceUploadId: string,
): Promise<void> {
  const deployResponse: LightMyRequestResponse = await deployFromSourceUpload(
    sessionToken,
    organizationSlug,
    sourceUploadId,
  );
  expectForbiddenDeployment(deployResponse);
  expect(await db.select().from(deployments)).toHaveLength(0);
  expect(await db.select().from(buildArtifacts)).toHaveLength(0);
  expect((await db.select().from(sourceUploads).where(eq(sourceUploads.id, sourceUploadId)))[0]?.consumedAt).toBeNull();
}

async function expectSourceUploadConsumptionHidden(
  sessionToken: string,
  organizationSlug: string,
  sourceUploadId: string,
): Promise<void> {
  const deployResponse: LightMyRequestResponse = await deployFromSourceUpload(
    sessionToken,
    organizationSlug,
    sourceUploadId,
  );
  expect(deployResponse.statusCode).toBe(404);
  expect(errorResponseSchema.parse(deployResponse.json()).error.code).toBe('source_upload_not_found');
  expect(await db.select().from(deployments)).toHaveLength(0);
  expect(await db.select().from(buildArtifacts)).toHaveLength(0);
  expect((await db.select().from(sourceUploads).where(eq(sourceUploads.id, sourceUploadId)))[0]?.consumedAt).toBeNull();
}

function expectForbiddenDeployment(deployResponse: LightMyRequestResponse): void {
  expect(deployResponse.statusCode).toBe(403);
  expect(errorResponseSchema.parse(deployResponse.json()).error.code).toBe('forbidden');
}

async function deployFromSourceUpload(
  sessionToken: string,
  organizationSlug: string,
  sourceUploadId: string,
): Promise<LightMyRequestResponse> {
  return await injectJsonDeployRequest(app, sessionToken, organizationSlug, { sourceUploadId });
}

async function createOrganization(sessionToken: string, name: string, slug: string): Promise<void> {
  const response: LightMyRequestResponse = await app.inject({
    headers: {
      authorization: `Bearer ${sessionToken}`,
    },
    method: 'POST',
    payload: {
      name,
      slug,
    },
    url: '/v1/organizations',
  });
  expect(response.statusCode).toBe(200);
}
