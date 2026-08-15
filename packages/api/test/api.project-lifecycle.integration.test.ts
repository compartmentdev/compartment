import {
  deploymentInspectResponseSchema,
  deploymentStatusResponseSchema,
  deployResponseSchema,
  errorResponseSchema,
  projectListResponseSchema,
  projectDeleteResponseSchema,
  projectReadResponseSchema,
  sourceUploadSummarySchema,
  type CompartmentAuthoredDescriptorInput,
  type ResourceReconcileIntent,
  type DeploymentInspectResponse,
  type DeploymentStatusResponse,
  type DeploymentSummary,
  type DeployResponse,
  type InstallResponse,
  type ProjectListResponse,
  type ProjectDeleteResponse,
  type SourceUploadSummary,
  type WorkerClaimDeploymentResponse,
  type WorkerClaimedDeployment,
  compartmentCurrentOrganizationHeaderName,
} from '@compartment/contracts';
import type { LightMyRequestResponse } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { eq } from 'drizzle-orm';
import type { ApiApp } from '../src/app.types';
import { createDatabase, createDatabasePool, type Database } from '../src/db/client';

import {
  buildArtifacts,
  deploymentKubeReferences,
  deploymentRoutes,
  deploymentRuns,
  deployments,
  environmentVariableValues,
  environments,
  operations,
  organizationQuotaReconciliation,
  organizations,
  principals,
  projectServices,
  projectKubeProvisioning,
  projectResources,
  projects,
  resourceReconcileRuns,
  gitProviderRegistrations,
  sourceBindings,
  sourceUploads,
  sources,
} from '../src/db/schema';
import type { ProjectRow } from '../src/queries/projects.query.types';
import { consumeSourceUploadAndCreateQueuedDeploymentBatch } from '../src/queries/deployment-batch.query';
import { findJoinedDeploymentById } from '../src/queries/deployment-joined.query';
import { createQueuedExistingArtifactDeploymentBatch } from '../src/queries/deployments.query';
import type {
  ConsumeSourceUploadAndCreateQueuedDeploymentBatchInput,
  ConsumeSourceUploadAndCreateQueuedDeploymentBatchResult,
  CreateQueuedDeploymentBatchItem,
  CreateQueuedExistingArtifactDeploymentBatchResult,
  DeploymentJoinedRow,
} from '../src/queries/deployments.query.types';
import { completeProjectProvisioning } from '../src/queries/project-provisioning-completion.query';
import { claimPendingProjectProvisioning } from '../src/queries/project-provisioning.query';
import type { ProjectProvisioningClaimRow } from '../src/queries/project-provisioning.query.types';
import { findNextDeploymentReconcilePair } from '../src/queries/deployment-reconcile.query';
import type { DeploymentKubeState } from '../src/queries/deployment-kube-state.types';
import { createResourceReconcileRun } from '../src/queries/resource-reconcile-create.query';
import { buildArtifactDeploymentBatchItem } from '../src/services/artifact-deployment-batch-item.service';
import { recoverOrphanedDeploymentBuildClaims } from '../src/services/deployment-worker.service';

import {
  acknowledgeKubeDeploymentStopped,
  buildOrganizationAuthorizationHeaders,
  claimNextQueuedDeployment,
  fetchArtifactSourceArchive,
  completeQueuedDeployment,
  injectDeployRequest,
  injectSourceUploadRequest,
  installCompartment as installCompartmentHarness,
  requireClaimedDeployment,
  requireDeployResponseDeployment,
  requireSingleDeployment,
  setVariable,
} from './api-integration.harness';
import type { StoredBuildArtifactRow, StoredDeploymentRow, StoredOperationRow } from './api.integration.types';
import {
  createApiIntegrationApps,
  createApiIntegrationTestContext,
  cleanupApiIntegrationRuntime,
  cleanupApiIntegrationTempDirectory,
  configureApiRuntimeWithPublicIngress,
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

interface ProjectLifecycleKubeStopServiceMockState {
  failure: Error | null;
}

interface ProjectLifecycleKubeStopServiceModule {
  stopKubeProjectDeployment: (deploymentId: string, state: DeploymentKubeState, updatedAt: Date) => Promise<void>;
}

const projectLifecycleKubeStopServiceMockState: ProjectLifecycleKubeStopServiceMockState = vi.hoisted(
  (): ProjectLifecycleKubeStopServiceMockState => ({ failure: null }),
);

vi.mock(
  '../src/services/project-lifecycle-kube-stop.service',
  async (
    importOriginal: () => Promise<ProjectLifecycleKubeStopServiceModule>,
  ): Promise<ProjectLifecycleKubeStopServiceModule> => {
    const actual: ProjectLifecycleKubeStopServiceModule = await importOriginal();
    class ProjectLifecycleKubeStopServiceTestAdapter implements ProjectLifecycleKubeStopServiceModule {
      public async stopKubeProjectDeployment(
        deploymentId: string,
        state: DeploymentKubeState,
        updatedAt: Date,
      ): Promise<void> {
        if (projectLifecycleKubeStopServiceMockState.failure !== null) {
          throw projectLifecycleKubeStopServiceMockState.failure;
        }
        await actual.stopKubeProjectDeployment(deploymentId, state, updatedAt);
      }
    }
    return new ProjectLifecycleKubeStopServiceTestAdapter();
  },
);

interface PreparedKubeLifecycleDeployment {
  deployment: DeploymentSummary;
  installPayload: InstallResponse;
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
} = createApiIntegrationTestContext('api_integration_project_lifecycle', 'api-integration-project-lifecycle');
let pool!: Pool;
let db!: Database;
let app!: ApiApp;
let systemApp!: ApiApp;
let hasInitializedApiIntegrationRuntime: boolean = false;

async function installCompartment(targetApp: ApiApp): Promise<InstallResponse> {
  const response: InstallResponse = await installCompartmentHarness(targetApp);
  await db
    .update(organizationQuotaReconciliation)
    .set({ state: 'succeeded' })
    .where(eq(organizationQuotaReconciliation.organizationId, response.organization.id));
  return response;
}

describe('Phase 0 API integration project lifecycle', (): void => {
  useApiDatabaseTestHarness(apiIntegrationDatabaseUrl);

  beforeEach(async (): Promise<void> => {
    projectLifecycleKubeStopServiceMockState.failure = null;
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
  it('shows disconnected remote state after archiving and unarchiving a git-bound project', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);

    const deployResponse: LightMyRequestResponse = await injectDeployRequest(
      app,
      installPayload.sessionToken,
      'acme-dev',
    );
    expect(deployResponse.statusCode).toBe(200);

    const organizationId: string =
      (
        await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.slug, 'acme-dev')).limit(1)
      )[0]?.id ?? '';
    const principalId: string =
      (
        await db
          .select({ id: principals.id })
          .from(principals)
          .where(eq(principals.email, 'admin@example.com'))
          .limit(1)
      )[0]?.id ?? '';
    const projectId: string =
      (await db.select({ id: projects.id }).from(projects).where(eq(projects.name, 'smoke-web')).limit(1))[0]?.id ?? '';
    expect(organizationId).not.toBe('');
    expect(principalId).not.toBe('');
    expect(projectId).not.toBe('');

    await db.insert(gitProviderRegistrations).values({
      appId: 'app_archive_unarchive_remote_state',
      appName: 'Compartment GitHub App',
      appSlug: 'compartment-github-app',
      appUrl: 'https://github.com/apps/compartment-github-app',
      bootstrapStateId: null,
      callbackUrl: 'https://console.example/v1/sources/git/providers/github/callback',
      createdByPrincipalId: principalId,
      id: 'gpr_archive_unarchive_remote_state',
      organizationId,
      pendingExpiresAt: null,
      privateKeyPemCiphertext: null,
      privateKeyPemEncryptionKeyId: null,
      providerHost: 'github.com',
      providerType: 'github_app',
      repositoryOwner: 'acme',
      status: 'active',
      webhookUrl: `https://console.example/v1/sources/git/providers/github/organizations/${organizationId}/registrations/gpr_archive_unarchive_remote_state/webhook`,
    });
    await db.insert(sources).values({
      autoAdoptNewApps: true,
      createdByPrincipalId: principalId,
      defaultAutoDeployEnabled: false,
      defaultBranchName: 'main',
      defaultEnvironmentName: 'production',
      disconnectedAt: null,
      displayName: 'acme/smoke-archive-unarchive',
      id: 'src_archive_unarchive_remote_state',
      organizationId,
      providerHost: 'github.com',
      providerInstallationId: 'inst_archive_unarchive_remote_state',
      providerRegistrationId: 'gpr_archive_unarchive_remote_state',
      repositoryCloneUrl: 'https://github.com/acme/smoke-archive-unarchive.git',
      repositoryExternalId: 'repo_archive_unarchive_remote_state',
      repositoryName: 'smoke-archive-unarchive',
      repositoryOwner: 'acme',
      status: 'active',
      syncBranchName: 'main',
      type: 'git',
      updatedAt: new Date('2026-04-28T12:05:00.000Z'),
    });
    await db.insert(sourceBindings).values({
      autoDeployEnabled: false,
      createdByPrincipalId: principalId,
      descriptorDirectory: '.',
      descriptorPath: 'compartment.yml',
      disconnectedAt: null,
      id: 'sbd_archive_unarchive_remote_state',
      projectId,
      projectName: 'smoke-web',
      sourceId: 'src_archive_unarchive_remote_state',
      status: 'active',
      updatedAt: new Date('2026-04-28T12:05:00.000Z'),
    });

    const showBeforeArchiveResponse: LightMyRequestResponse = await app.inject({
      method: 'GET',
      url: '/v1/projects/smoke-web',
      headers: buildOrganizationAuthorizationHeaders(installPayload.sessionToken),
    });
    expect(showBeforeArchiveResponse.statusCode).toBe(200);
    expect(projectReadResponseSchema.parse(showBeforeArchiveResponse.json()).remoteState).toBe('active');

    const archiveResponse: LightMyRequestResponse = await app.inject({
      method: 'POST',
      url: '/v1/projects/smoke-web/archive',
      headers: buildOrganizationAuthorizationHeaders(installPayload.sessionToken),
    });
    expect(archiveResponse.statusCode).toBe(200);

    const unarchiveResponse: LightMyRequestResponse = await app.inject({
      method: 'POST',
      url: '/v1/projects/smoke-web/unarchive',
      headers: buildOrganizationAuthorizationHeaders(installPayload.sessionToken),
    });
    expect(unarchiveResponse.statusCode).toBe(200);

    const showAfterUnarchiveResponse: LightMyRequestResponse = await app.inject({
      method: 'GET',
      url: '/v1/projects/smoke-web',
      headers: buildOrganizationAuthorizationHeaders(installPayload.sessionToken),
    });
    expect(showAfterUnarchiveResponse.statusCode).toBe(200);
    expect(projectReadResponseSchema.parse(showAfterUnarchiveResponse.json()).remoteState).toBe('disconnected');
  });

  it('deletes an archived project, removes project-owned state, and allows same-slug recreation', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);

    const deployPayload: DeployResponse = deployResponseSchema.parse(
      (await injectDeployRequest(app, installPayload.sessionToken, 'acme-dev')).json(),
    );
    const deployment: DeploymentSummary = requireDeployResponseDeployment(deployPayload);

    await completeQueuedDeployment(app, deployment.id);
    await setVariable(app, installPayload.sessionToken, 'acme-dev', {
      environmentName: 'production',
      keyName: 'LOG_LEVEL',
      projectName: 'smoke-web',
      sensitivity: 'plain',
      value: 'debug',
    });

    const archiveResponsePromise: Promise<LightMyRequestResponse> = app.inject({
      method: 'POST',
      url: '/v1/projects/smoke-web/archive',
      headers: {
        authorization: `Bearer ${installPayload.sessionToken}`,
        [compartmentCurrentOrganizationHeaderName]: 'acme-dev',
      },
    });
    await acknowledgeKubeDeploymentStopped(deployment.id);
    const archiveResponse: LightMyRequestResponse = await archiveResponsePromise;
    expect(archiveResponse.statusCode).toBe(200);

    const deletedProjectId: string =
      (await db.select({ id: projects.id }).from(projects).where(eq(projects.name, 'smoke-web')).limit(1))[0]?.id ?? '';

    const deleteResponse: LightMyRequestResponse = await deleteArchivedProject(installPayload.sessionToken);
    expect(deleteResponse.statusCode).toBe(200);
    const deletePayload: ProjectDeleteResponse = projectDeleteResponseSchema.parse(deleteResponse.json());
    expect(deletePayload.projectName).toBe('smoke-web');

    expect(await db.select().from(projects)).toHaveLength(0);
    expect(await db.select().from(projectServices)).toHaveLength(0);
    expect(await db.select().from(environments)).toHaveLength(0);
    expect(await db.select().from(buildArtifacts)).toHaveLength(0);
    expect(await db.select().from(deployments)).toHaveLength(0);
    expect(await db.select().from(deploymentRoutes)).toHaveLength(0);
    expect(await db.select().from(environmentVariableValues)).toHaveLength(0);
    expect(await db.select().from(operations)).not.toHaveLength(0);

    const showResponse: LightMyRequestResponse = await app.inject({
      method: 'GET',
      url: '/v1/projects/smoke-web',
      headers: {
        authorization: `Bearer ${installPayload.sessionToken}`,
        [compartmentCurrentOrganizationHeaderName]: 'acme-dev',
      },
    });
    expect(showResponse.statusCode).toBe(404);

    const redeployResponse: LightMyRequestResponse = await injectDeployRequest(
      app,
      installPayload.sessionToken,
      'acme-dev',
    );
    expect(redeployResponse.statusCode).toBe(200);

    const recreatedProjects: ProjectRow[] = await db.select().from(projects).where(eq(projects.name, 'smoke-web'));
    expect(recreatedProjects).toHaveLength(1);
    expect(recreatedProjects[0]?.id).not.toBe(deletedProjectId);
  });
  it('archives and deletes a project whose volume resource was never bootstrapped', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);
    const deployResponse: LightMyRequestResponse = await injectDeployRequest(
      app,
      installPayload.sessionToken,
      'acme-dev',
      { descriptor: createUnbootstrappedResourceDescriptor() },
    );
    expect(deployResponse.statusCode).toBe(200);
    const deployment: DeploymentSummary = requireDeployResponseDeployment(
      deployResponseSchema.parse(deployResponse.json()),
    );
    await completeQueuedDeployment(app, deployment.id);

    const [resourceBeforeArchive] = await db.select().from(projectResources);
    const [projectBeforeArchive] = await db.select().from(projects);
    expect(resourceBeforeArchive).toMatchObject({ expectedClaimsJson: '[]', status: 'stopped' });
    await createResourceReconcileRun({
      expectedClaims: [],
      intent: createUnbootstrappedResourceIntent(resourceBeforeArchive!, projectBeforeArchive!),
      operationId: 'resource_operation_pending_archive',
      type: 'bootstrap',
    });
    expect(await db.select().from(resourceReconcileRuns)).toMatchObject([{ phase: 'bootstrap-pending' }]);

    const archiveResponsePromise: Promise<LightMyRequestResponse> = app.inject({
      method: 'POST',
      url: '/v1/projects/smoke-web/archive',
      headers: buildOrganizationAuthorizationHeaders(installPayload.sessionToken),
    });
    await acknowledgeKubeDeploymentStopped(deployment.id);
    const archiveResponse: LightMyRequestResponse = await archiveResponsePromise;
    expect(archiveResponse.statusCode).toBe(200);
    expect(await db.select().from(projectResources)).toMatchObject([{ expectedClaimsJson: '[]', status: 'stopped' }]);
    expect(await db.select().from(resourceReconcileRuns)).toMatchObject([
      {
        failureMessage: 'Resource reconciliation was canceled because the project was archived.',
        phase: 'failed',
      },
    ]);

    const deleteResponse: LightMyRequestResponse = await deleteArchivedProject(installPayload.sessionToken);
    expect(deleteResponse.statusCode).toBe(200);
    expect(await db.select().from(projects)).toEqual([]);
  });
  it('archives a provisioned Kubernetes project without calling legacy node cleanup', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);
    const deployment: DeploymentSummary = requireDeployResponseDeployment(
      deployResponseSchema.parse((await injectDeployRequest(app, installPayload.sessionToken, 'acme-dev')).json()),
    );
    await completeQueuedDeployment(app, deployment.id);
    const projectId: string =
      (await db.select({ id: projects.id }).from(projects).where(eq(projects.name, 'smoke-web')).limit(1))[0]?.id ?? '';
    await db
      .update(projectKubeProvisioning)
      .set({ state: 'succeeded' })
      .where(eq(projectKubeProvisioning.projectId, projectId));
    await db
      .update(deploymentKubeReferences)
      .set({ state: 'stopped' })
      .where(eq(deploymentKubeReferences.deploymentId, deployment.id));

    const archiveResponse: LightMyRequestResponse = await app.inject({
      method: 'POST',
      url: '/v1/projects/smoke-web/archive',
      headers: buildOrganizationAuthorizationHeaders(installPayload.sessionToken),
    });

    expect(archiveResponse.statusCode).toBe(200);
  });
  it.each(['desired', 'pending'] as const)(
    'stops and deletes a project whose active Kubernetes deployment is %s',
    async (state: 'desired' | 'pending'): Promise<void> => {
      const { deployment, installPayload, projectId }: PreparedKubeLifecycleDeployment =
        await prepareKubeLifecycleDeployment(state, state === 'pending');

      const archiveResponsePromise: Promise<LightMyRequestResponse> = app.inject({
        method: 'POST',
        url: '/v1/projects/smoke-web/archive',
        headers: buildOrganizationAuthorizationHeaders(installPayload.sessionToken),
      });
      await acknowledgeKubeDeploymentStopped(deployment.id);
      expect((await archiveResponsePromise).statusCode).toBe(200);

      const deleteResponse: LightMyRequestResponse = await deleteArchivedProject(installPayload.sessionToken);
      expect(deleteResponse.statusCode).toBe(200);
      expect(await db.select().from(projects).where(eq(projects.id, projectId))).toHaveLength(0);
    },
  );
  it('stops a project whose active Kubernetes deployment is desired', async (): Promise<void> => {
    const { deployment, installPayload }: PreparedKubeLifecycleDeployment = await prepareKubeLifecycleDeployment(
      'desired',
      true,
    );

    const stopResponsePromise: Promise<LightMyRequestResponse> = app.inject({
      method: 'POST',
      url: '/v1/projects/smoke-web/stop',
      headers: buildOrganizationAuthorizationHeaders(installPayload.sessionToken),
      payload: {},
    });
    await acknowledgeKubeDeploymentStopped(deployment.id);

    expect((await stopResponsePromise).statusCode).toBe(200);
    const [storedDeployment] = await db.select().from(deployments).where(eq(deployments.id, deployment.id));
    expect(storedDeployment).toMatchObject({ isActive: false, promotionStage: 'stopped', status: 'stopped' });
  });
  it('preserves a failed deployment while cleaning up its Kubernetes runtime', async (): Promise<void> => {
    const { deployment, installPayload }: PreparedKubeLifecycleDeployment = await prepareKubeLifecycleDeployment(
      'pending',
      false,
    );
    await db
      .update(deployments)
      .set({ failureMessage: 'rollout failed', health: 'unhealthy', status: 'failed' })
      .where(eq(deployments.id, deployment.id));

    const archiveResponsePromise: Promise<LightMyRequestResponse> = app.inject({
      method: 'POST',
      url: '/v1/projects/smoke-web/archive',
      headers: buildOrganizationAuthorizationHeaders(installPayload.sessionToken),
    });
    await acknowledgeKubeDeploymentStopped(deployment.id);

    expect((await archiveResponsePromise).statusCode).toBe(200);
    const [storedDeployment] = await db.select().from(deployments).where(eq(deployments.id, deployment.id));
    expect(storedDeployment).toMatchObject({
      failureMessage: 'rollout failed',
      health: 'unhealthy',
      status: 'failed',
    });
  });
  it('finishes lifecycle persistence after Kubernetes already stopped a desired deployment', async (): Promise<void> => {
    const { deployment, installPayload, projectId }: PreparedKubeLifecycleDeployment =
      await prepareKubeLifecycleDeployment('desired', false);
    await db
      .update(deploymentKubeReferences)
      .set({ state: 'stopped' })
      .where(eq(deploymentKubeReferences.deploymentId, deployment.id));

    const archiveResponse: LightMyRequestResponse = await app.inject({
      method: 'POST',
      url: '/v1/projects/smoke-web/archive',
      headers: buildOrganizationAuthorizationHeaders(installPayload.sessionToken),
    });
    expect(archiveResponse.statusCode).toBe(200);
    const deleteResponse: LightMyRequestResponse = await deleteArchivedProject(installPayload.sessionToken);
    expect(deleteResponse.statusCode).toBe(200);
    expect(await db.select().from(projects).where(eq(projects.id, projectId))).toHaveLength(0);
  });
  it('requires archive before deleting a project', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);

    const deployResponse: LightMyRequestResponse = await injectDeployRequest(
      app,
      installPayload.sessionToken,
      'acme-dev',
    );
    expect(deployResponse.statusCode).toBe(200);

    const deleteResponse: LightMyRequestResponse = await app.inject({
      method: 'DELETE',
      url: '/v1/projects/smoke-web',
      headers: {
        authorization: `Bearer ${installPayload.sessionToken}`,
        [compartmentCurrentOrganizationHeaderName]: 'acme-dev',
      },
    });
    expect(deleteResponse.statusCode).toBe(409);
    expect(errorResponseSchema.parse(deleteResponse.json()).error.code).toBe('project_delete_requires_archive');
  });
  it('blocks deleting a project left archived after archive stop failure', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);

    const deployPayload: DeployResponse = deployResponseSchema.parse(
      (await injectDeployRequest(app, installPayload.sessionToken, 'acme-dev')).json(),
    );
    const deployment: DeploymentSummary = requireDeployResponseDeployment(deployPayload);

    await completeQueuedDeployment(app, deployment.id);

    projectLifecycleKubeStopServiceMockState.failure = new Error('Kubernetes stop failed.');
    const archiveResponse: LightMyRequestResponse = await app.inject({
      method: 'POST',
      url: '/v1/projects/smoke-web/archive',
      headers: {
        authorization: `Bearer ${installPayload.sessionToken}`,
        [compartmentCurrentOrganizationHeaderName]: 'acme-dev',
      },
    });
    expect(archiveResponse.statusCode).toBe(502);
    expect(errorResponseSchema.parse(archiveResponse.json()).error.code).toBe('project_archive_runtime_stop_failed');

    const archivedProjects: ProjectRow[] = await db.select().from(projects).where(eq(projects.name, 'smoke-web'));
    const storedDeployments: StoredDeploymentRow[] = await db.select().from(deployments);
    expect(archivedProjects[0]?.archivedAt).not.toBeNull();
    expect(storedDeployments[0]?.isActive).toBe(true);

    const deleteResponse: LightMyRequestResponse = await app.inject({
      method: 'DELETE',
      url: '/v1/projects/smoke-web',
      headers: {
        authorization: `Bearer ${installPayload.sessionToken}`,
        [compartmentCurrentOrganizationHeaderName]: 'acme-dev',
      },
    });
    expect(deleteResponse.statusCode).toBe(409);
    expect(errorResponseSchema.parse(deleteResponse.json()).error.code).toBe('project_delete_blocked');
  });
  it('stops inactive queued deployments during archive and then deletes the project', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);

    const deployResponse: LightMyRequestResponse = await injectDeployRequest(
      app,
      installPayload.sessionToken,
      'acme-dev',
    );
    expect(deployResponse.statusCode).toBe(200);

    const archiveResponse: LightMyRequestResponse = await app.inject({
      method: 'POST',
      url: '/v1/projects/smoke-web/archive',
      headers: {
        authorization: `Bearer ${installPayload.sessionToken}`,
        [compartmentCurrentOrganizationHeaderName]: 'acme-dev',
      },
    });
    expect(archiveResponse.statusCode).toBe(200);

    const [storedDeployment]: StoredDeploymentRow[] = await db.select().from(deployments);
    expect(storedDeployment).toMatchObject({
      isActive: false,
      promotionStage: 'stopped',
      status: 'stopped',
    });
    expect(storedDeployment?.completedAt).toBeInstanceOf(Date);
    const [storedProject]: ProjectRow[] = await db.select().from(projects).where(eq(projects.name, 'smoke-web'));
    expect(storedDeployment?.completedAt).toEqual(storedProject?.archivedAt);
    expect(storedDeployment?.completedAt?.getTime()).toBeGreaterThanOrEqual(storedDeployment?.createdAt.getTime() ?? 0);
    const [storedOperation]: StoredOperationRow[] = await db
      .select()
      .from(operations)
      .where(eq(operations.id, storedDeployment!.operationId));
    expect(storedOperation).toMatchObject({
      status: 'failed',
      summary: 'Deployment was stopped because the project was archived.',
    });
    expect(storedOperation?.completedAt).toEqual(storedProject?.archivedAt);

    const deleteResponse: LightMyRequestResponse = await app.inject({
      method: 'DELETE',
      url: '/v1/projects/smoke-web',
      headers: {
        authorization: `Bearer ${installPayload.sessionToken}`,
        [compartmentCurrentOrganizationHeaderName]: 'acme-dev',
      },
    });
    expect(deleteResponse.statusCode).toBe(200);
  });
  it('repairs inactive queued deployments for legacy archived projects before deletion', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);

    const deployResponse: LightMyRequestResponse = await injectDeployRequest(
      app,
      installPayload.sessionToken,
      'acme-dev',
    );
    expect(deployResponse.statusCode).toBe(200);

    const [project]: ProjectRow[] = await db.select().from(projects).where(eq(projects.name, 'smoke-web'));
    const [queuedDeployment]: StoredDeploymentRow[] = await db.select().from(deployments);
    if (project === undefined || queuedDeployment === undefined) {
      throw new Error('Expected the legacy archived project and its queued deployment.');
    }
    const archivedAt: Date = new Date();
    await db.update(projects).set({ archivedAt, updatedAt: archivedAt }).where(eq(projects.id, project.id));
    const [legacyArchivedProject]: ProjectRow[] = await db.select().from(projects).where(eq(projects.id, project.id));
    const [queuedOperation]: StoredOperationRow[] = await db
      .select()
      .from(operations)
      .where(eq(operations.id, queuedDeployment.operationId));
    expect(legacyArchivedProject?.archivedAt).toEqual(archivedAt);
    expect(queuedDeployment).toMatchObject({
      completedAt: null,
      isActive: false,
      status: 'queued',
    });
    expect(queuedOperation).toMatchObject({ completedAt: null, status: 'queued' });

    const deleteResponse: LightMyRequestResponse = await app.inject({
      method: 'DELETE',
      url: '/v1/projects/smoke-web',
      headers: buildOrganizationAuthorizationHeaders(installPayload.sessionToken),
    });
    expect(deleteResponse.statusCode).toBe(200);

    const [stoppedDeployment]: StoredDeploymentRow[] = await db
      .select()
      .from(deployments)
      .where(eq(deployments.id, queuedDeployment.id));
    expect(stoppedDeployment).toMatchObject({
      isActive: false,
      promotionStage: 'stopped',
      status: 'stopped',
    });
    expect(stoppedDeployment?.completedAt).toBeInstanceOf(Date);
    const [storedOperation]: StoredOperationRow[] = await db
      .select()
      .from(operations)
      .where(eq(operations.id, queuedDeployment.operationId));
    expect(storedOperation).toMatchObject({
      status: 'failed',
      summary: 'Deployment was stopped because the project was archived.',
    });
    expect(storedOperation?.completedAt).toEqual(stoppedDeployment?.completedAt);

    const teardown: ProjectProvisioningClaimRow = await waitForProjectTeardownClaim();
    await completeProjectProvisioning({
      action: 'teardown',
      failureMessage: null,
      isolationVersion: teardown.isolationVersion,
      leaseId: teardown.leaseId,
      projectId: teardown.projectId,
      status: 'succeeded',
    });
    await expect(db.select().from(projects).where(eq(projects.id, project.id))).resolves.toHaveLength(0);
  });
  it('rejects queued deployment creation that loses the project archive race', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);
    const deployment: DeploymentSummary = requireDeployResponseDeployment(
      deployResponseSchema.parse((await injectDeployRequest(app, installPayload.sessionToken, 'acme-dev')).json()),
    );
    const sourceDeployment: DeploymentJoinedRow | undefined = await findJoinedDeploymentById(
      deployment.id,
      defaultApiConfig.baseDomain,
    );
    if (sourceDeployment === undefined) {
      throw new Error('Expected the queued source deployment.');
    }
    await db.insert(deploymentRuns).values({
      environmentId: sourceDeployment.environment.id,
      id: 'drn_archive_queue_race',
      triggerType: 'start',
    });
    const deploymentCountBeforeQueue: number = (await db.select({ id: deployments.id }).from(deployments)).length;
    const operationCountBeforeQueue: number = (await db.select({ id: operations.id }).from(operations)).length;

    const archiveClient: PoolClient = await pool.connect();
    let queueResult: Promise<CreateQueuedExistingArtifactDeploymentBatchResult> | null = null;
    try {
      await archiveClient.query('begin');
      await archiveClient.query('update projects set archived_at = now() where id = $1', [sourceDeployment.project.id]);
      queueResult = createQueuedExistingArtifactDeploymentBatch([
        buildArtifactDeploymentBatchItem(
          sourceDeployment,
          sourceDeployment.environment,
          sourceDeployment.operation.actorPrincipalId ?? '',
          'drn_archive_queue_race',
          'deployment.start',
        ),
      ]);
      await Promise.race([
        queueResult.then((): never => {
          throw new Error('Expected queued deployment creation to wait for the project archive transaction.');
        }),
        waitForDatabaseBlocker(archiveClient),
      ]);

      await archiveClient.query('commit');
      await expect(queueResult).resolves.toBe('project-archived');
      await expect(db.select().from(deployments)).resolves.toHaveLength(deploymentCountBeforeQueue);
      await expect(db.select().from(operations)).resolves.toHaveLength(operationCountBeforeQueue);
    } finally {
      await archiveClient.query('rollback');
      await Promise.allSettled(queueResult === null ? [] : [queueResult]);
      archiveClient.release();
    }
  }, 10_000);
  it('leaves a source upload unconsumed when deployment queue creation loses the archive race', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);
    const deployment: DeploymentSummary = requireDeployResponseDeployment(
      deployResponseSchema.parse((await injectDeployRequest(app, installPayload.sessionToken, 'acme-dev')).json()),
    );
    const sourceDeployment: DeploymentJoinedRow | undefined = await findJoinedDeploymentById(
      deployment.id,
      defaultApiConfig.baseDomain,
    );
    if (sourceDeployment?.operation.actorPrincipalId == null) {
      throw new Error('Expected the queued source deployment and its actor.');
    }
    const sourceUploadResponse: LightMyRequestResponse = await injectSourceUploadRequest(
      app,
      installPayload.sessionToken,
      'acme-dev',
    );
    expect(sourceUploadResponse.statusCode).toBe(200);
    const sourceUpload: SourceUploadSummary = sourceUploadSummarySchema.parse(sourceUploadResponse.json());
    const [persistedSourceUpload] = await db.select().from(sourceUploads).where(eq(sourceUploads.id, sourceUpload.id));
    if (persistedSourceUpload === undefined) {
      throw new Error('Expected the pending source upload.');
    }
    const queuedAt: Date = new Date();
    const deploymentRunId: string = 'drn_source_upload_archive_race';
    await db.insert(deploymentRuns).values({
      environmentId: sourceDeployment.environment.id,
      id: deploymentRunId,
      triggerType: 'manual',
    });
    const batchItem: CreateQueuedDeploymentBatchItem = {
      artifact: {
        createdByPrincipalId: sourceDeployment.operation.actorPrincipalId,
        id: 'art_source_upload_archive_race',
        imageRepository: sourceDeployment.artifact.imageRepository,
        projectId: sourceDeployment.project.id,
        projectServiceId: sourceDeployment.service.id,
        resolvedBuildEnvJson: sourceDeployment.artifact.resolvedBuildEnvJson,
        resolvedBuildJson: sourceDeployment.artifact.resolvedBuildJson,
        sourceDigest: persistedSourceUpload.sourceDigest,
        sourceUploadId: persistedSourceUpload.id,
        updatedAt: queuedAt,
      },
      deployment: {
        accessMode: sourceDeployment.deployment.accessMode,
        deploymentRunId,
        environmentId: sourceDeployment.environment.id,
        health: sourceDeployment.deployment.health,
        id: 'dep_source_upload_archive_race',
        label: null,
        promotionStage: sourceDeployment.deployment.promotionStage,
        projectServiceId: sourceDeployment.service.id,
        resolvedPortsJson: sourceDeployment.deployment.resolvedPortsJson,
        resolvedReadinessJson: sourceDeployment.deployment.resolvedReadinessJson,
        resolvedReleaseJson: sourceDeployment.deployment.resolvedReleaseJson,
        resolvedRoutesJson: sourceDeployment.deployment.resolvedRoutesJson,
        resolvedRunJson: sourceDeployment.deployment.resolvedRunJson,
        status: sourceDeployment.deployment.status,
        updatedAt: queuedAt,
      },
      operation: {
        actorPrincipalId: sourceDeployment.operation.actorPrincipalId,
        organizationId: sourceDeployment.project.organizationId,
        status: 'queued',
        summary: 'Queued deployment for source upload archive race test.',
        targetId: sourceDeployment.environment.id,
        targetType: 'environment',
        type: 'deployment.run',
      },
    };
    const batchInput: ConsumeSourceUploadAndCreateQueuedDeploymentBatchInput = {
      actorPrincipalId: sourceDeployment.operation.actorPrincipalId,
      consumedAt: queuedAt,
      environmentId: sourceDeployment.environment.id,
      expiresAtCutoff: queuedAt,
      items: [batchItem],
      organizationId: sourceDeployment.project.organizationId,
      projectId: sourceDeployment.project.id,
      projectServiceIds: [sourceDeployment.service.id],
      sourceUploadId: persistedSourceUpload.id,
    };
    const deploymentCountBeforeQueue: number = (await db.select({ id: deployments.id }).from(deployments)).length;
    const artifactCountBeforeQueue: number = (await db.select({ id: buildArtifacts.id }).from(buildArtifacts)).length;
    const operationCountBeforeQueue: number = (await db.select({ id: operations.id }).from(operations)).length;

    const archiveClient: PoolClient = await pool.connect();
    let queueResult: Promise<ConsumeSourceUploadAndCreateQueuedDeploymentBatchResult> | null = null;
    try {
      await archiveClient.query('begin');
      await archiveClient.query('update projects set archived_at = now() where id = $1', [sourceDeployment.project.id]);
      queueResult = consumeSourceUploadAndCreateQueuedDeploymentBatch(batchInput);
      await Promise.race([
        queueResult.then((): never => {
          throw new Error('Expected source-upload deployment creation to wait for the project archive transaction.');
        }),
        waitForDatabaseBlocker(archiveClient),
      ]);

      await archiveClient.query('commit');
      await expect(queueResult).resolves.toBe('project-archived');
      await expect(
        db
          .select({ consumedAt: sourceUploads.consumedAt })
          .from(sourceUploads)
          .where(eq(sourceUploads.id, sourceUpload.id)),
      ).resolves.toEqual([{ consumedAt: null }]);
      await expect(db.select().from(deployments)).resolves.toHaveLength(deploymentCountBeforeQueue);
      await expect(db.select().from(buildArtifacts)).resolves.toHaveLength(artifactCountBeforeQueue);
      await expect(db.select().from(operations)).resolves.toHaveLength(operationCountBeforeQueue);
    } finally {
      await archiveClient.query('rollback');
      await Promise.allSettled(queueResult === null ? [] : [queueResult]);
      archiveClient.release();
    }
  }, 10_000);
  it('does not claim a queued deployment after project archive wins the lock race', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);
    const deployment: DeploymentSummary = requireDeployResponseDeployment(
      deployResponseSchema.parse((await injectDeployRequest(app, installPayload.sessionToken, 'acme-dev')).json()),
    );
    const [project]: ProjectRow[] = await db.select().from(projects).where(eq(projects.name, 'smoke-web'));
    if (project === undefined) {
      throw new Error('Expected the deployment project.');
    }

    const archiveClient: PoolClient = await pool.connect();
    let claimResult: Promise<WorkerClaimDeploymentResponse> | null = null;
    try {
      await archiveClient.query('begin');
      await archiveClient.query('update projects set archived_at = now() where id = $1', [project.id]);
      claimResult = claimNextQueuedDeployment(app);
      await Promise.race([
        claimResult.then((): never => {
          throw new Error('Expected deployment claim to wait for the project archive transaction.');
        }),
        waitForDatabaseBlocker(archiveClient),
      ]);

      await archiveClient.query('commit');
      await expect(claimResult).resolves.toMatchObject({ deployment: null });
      const [storedDeployment]: StoredDeploymentRow[] = await db
        .select()
        .from(deployments)
        .where(eq(deployments.id, deployment.id));
      expect(storedDeployment).toMatchObject({ status: 'queued' });
    } finally {
      await archiveClient.query('rollback');
      await Promise.allSettled(claimResult === null ? [] : [claimResult]);
      archiveClient.release();
    }
  }, 10_000);
  it('blocks deleting archived projects with running deployments', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);

    const deployPayload: DeployResponse = deployResponseSchema.parse(
      (await injectDeployRequest(app, installPayload.sessionToken, 'acme-dev')).json(),
    );

    await claimNextQueuedDeployment(app);
    expect(requireDeployResponseDeployment(deployPayload).id).toBeTruthy();

    const archiveResponse: LightMyRequestResponse = await app.inject({
      method: 'POST',
      url: '/v1/projects/smoke-web/archive',
      headers: {
        authorization: `Bearer ${installPayload.sessionToken}`,
        [compartmentCurrentOrganizationHeaderName]: 'acme-dev',
      },
    });
    expect(archiveResponse.statusCode).toBe(200);

    const deleteResponse: LightMyRequestResponse = await app.inject({
      method: 'DELETE',
      url: '/v1/projects/smoke-web',
      headers: {
        authorization: `Bearer ${installPayload.sessionToken}`,
        [compartmentCurrentOrganizationHeaderName]: 'acme-dev',
      },
    });
    expect(deleteResponse.statusCode).toBe(409);
    expect(errorResponseSchema.parse(deleteResponse.json()).error.code).toBe('project_delete_blocked');

    const deployment: DeploymentSummary = requireDeployResponseDeployment(deployPayload);
    await db
      .update(deployments)
      .set({ updatedAt: new Date(0) })
      .where(eq(deployments.id, deployment.id));
    await db.insert(deploymentKubeReferences).values({
      deploymentId: deployment.id,
      deploymentName: 'app-smoke-web',
      id: 'kref_archived_running_safety',
      namespace: 'cpt-prj-smoke-web',
      networkPolicyNamesJson: '[]',
      serviceName: 'app-smoke-web',
      state: 'desired',
    });
    await expect(recoverOrphanedDeploymentBuildClaims(1_000)).resolves.toBe(0);
    const [handedOffDeployment]: StoredDeploymentRow[] = await db
      .select()
      .from(deployments)
      .where(eq(deployments.id, deployment.id));
    expect(handedOffDeployment).toMatchObject({ status: 'running' });
    const handedOffDeleteResponse: LightMyRequestResponse = await app.inject({
      method: 'DELETE',
      url: '/v1/projects/smoke-web',
      headers: buildOrganizationAuthorizationHeaders(installPayload.sessionToken),
    });
    expect(handedOffDeleteResponse.statusCode).toBe(409);
    expect(errorResponseSchema.parse(handedOffDeleteResponse.json()).error.code).toBe('project_delete_blocked');

    await db.delete(deploymentKubeReferences).where(eq(deploymentKubeReferences.deploymentId, deployment.id));
    await expect(recoverOrphanedDeploymentBuildClaims(1_000)).resolves.toBe(0);
    const [recoveredDeployment]: StoredDeploymentRow[] = await db
      .select()
      .from(deployments)
      .where(eq(deployments.id, deployment.id));
    expect(recoveredDeployment).toMatchObject({ isActive: false, promotionStage: 'stopped', status: 'stopped' });
    await expect(deleteArchivedProject(installPayload.sessionToken)).resolves.toMatchObject({ statusCode: 200 });
  });
  it('reuses the same public route after archiving, unarchiving, and redeploying a project', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);

    const firstDeployPayload: DeployResponse = deployResponseSchema.parse(
      (await injectDeployRequest(app, installPayload.sessionToken, 'acme-dev')).json(),
    );
    const firstClaimedPayload: WorkerClaimDeploymentResponse = await claimNextQueuedDeployment(app);
    const firstClaimedDeployment: WorkerClaimedDeployment | null = firstClaimedPayload.deployment;
    const firstDeployment: DeploymentSummary = requireDeployResponseDeployment(firstDeployPayload);

    expect(firstClaimedDeployment).not.toBeNull();
    if (firstClaimedDeployment === null) {
      throw new Error('Expected a claimed deployment.');
    }

    const firstRouteHost: string = firstClaimedDeployment.routeHost;

    expect(firstRouteHost).toBe('smoke-web.localhost');

    await completeQueuedDeployment(app, firstDeployment.id, firstRouteHost);

    const archiveResponsePromise: Promise<LightMyRequestResponse> = app.inject({
      method: 'POST',
      url: '/v1/projects/smoke-web/archive',
      headers: {
        authorization: `Bearer ${installPayload.sessionToken}`,
        [compartmentCurrentOrganizationHeaderName]: 'acme-dev',
      },
    });
    await acknowledgeKubeDeploymentStopped(firstDeployment.id);
    const archiveResponse: LightMyRequestResponse = await archiveResponsePromise;
    expect(archiveResponse.statusCode).toBe(200);

    const unarchiveResponse: LightMyRequestResponse = await app.inject({
      method: 'POST',
      url: '/v1/projects/smoke-web/unarchive',
      headers: {
        authorization: `Bearer ${installPayload.sessionToken}`,
        [compartmentCurrentOrganizationHeaderName]: 'acme-dev',
      },
    });
    expect(unarchiveResponse.statusCode).toBe(200);

    const statusAfterUnarchiveResponse: LightMyRequestResponse = await app.inject({
      method: 'GET',
      url: '/v1/deployments/status?projectName=smoke-web',
      headers: {
        authorization: `Bearer ${installPayload.sessionToken}`,
        [compartmentCurrentOrganizationHeaderName]: 'acme-dev',
      },
    });
    expect(statusAfterUnarchiveResponse.statusCode).toBe(200);
    const statusAfterUnarchivePayload: DeploymentStatusResponse = deploymentStatusResponseSchema.parse(
      statusAfterUnarchiveResponse.json(),
    );
    expect(requireSingleDeployment(statusAfterUnarchivePayload.deployments).routeUrl).toBe(`http://${firstRouteHost}`);

    const inspectAfterUnarchiveResponse: LightMyRequestResponse = await app.inject({
      method: 'GET',
      url: '/v1/deployments/inspect?projectName=smoke-web',
      headers: {
        authorization: `Bearer ${installPayload.sessionToken}`,
        [compartmentCurrentOrganizationHeaderName]: 'acme-dev',
      },
    });
    expect(inspectAfterUnarchiveResponse.statusCode).toBe(200);
    const inspectAfterUnarchivePayload: DeploymentInspectResponse = deploymentInspectResponseSchema.parse(
      inspectAfterUnarchiveResponse.json(),
    );
    expect(requireSingleDeployment(inspectAfterUnarchivePayload.deployments).routeHost).toBe(firstRouteHost);

    const redeployPayload: DeployResponse = deployResponseSchema.parse(
      (await injectDeployRequest(app, installPayload.sessionToken, 'acme-dev')).json(),
    );
    const redeployDeployment: DeploymentSummary = requireDeployResponseDeployment(redeployPayload);
    const redeployClaimedPayload: WorkerClaimDeploymentResponse = await claimNextQueuedDeployment(app);

    expect(redeployClaimedPayload.deployment?.deploymentId).toBe(redeployDeployment.id);
    expect(redeployClaimedPayload.deployment?.routeHost).toBe(firstRouteHost);
  });
  it('skips queued deployments for archived projects during worker claim', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);

    const deployResponse: LightMyRequestResponse = await injectDeployRequest(
      app,
      installPayload.sessionToken,
      'acme-dev',
    );
    expect(deployResponse.statusCode).toBe(200);

    const archiveResponse: LightMyRequestResponse = await app.inject({
      method: 'POST',
      url: '/v1/projects/smoke-web/archive',
      headers: {
        authorization: `Bearer ${installPayload.sessionToken}`,
        [compartmentCurrentOrganizationHeaderName]: 'acme-dev',
      },
    });
    expect(archiveResponse.statusCode).toBe(200);

    const claimedPayload: WorkerClaimDeploymentResponse = await claimNextQueuedDeployment(app);
    expect(claimedPayload.deployment).toBeNull();
  });
  it('keeps the removed Docker completion route unavailable after worker claim', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);

    const deployResponse: LightMyRequestResponse = await injectDeployRequest(
      app,
      installPayload.sessionToken,
      'acme-dev',
    );
    expect(deployResponse.statusCode).toBe(200);
    const deployPayload: DeployResponse = deployResponseSchema.parse(deployResponse.json());
    const deployment: DeploymentSummary = requireDeployResponseDeployment(deployPayload);

    const claimedDeployment: WorkerClaimedDeployment = requireClaimedDeployment(await claimNextQueuedDeployment(app));
    expect(claimedDeployment.deploymentId).toBe(deployment.id);

    const archiveResponse: LightMyRequestResponse = await app.inject({
      method: 'POST',
      url: '/v1/projects/smoke-web/archive',
      headers: {
        authorization: `Bearer ${installPayload.sessionToken}`,
        [compartmentCurrentOrganizationHeaderName]: 'acme-dev',
      },
    });
    expect(archiveResponse.statusCode).toBe(200);

    const completedResponse: LightMyRequestResponse = await app.inject({
      headers: {
        authorization: 'Bearer test-runtime-control-token',
      },
      method: 'POST',
      payload: {
        deploymentId: deployment.id,
        imageRef: 'sha256:image',
        routeHost: '127.0.0.1',
      },
      url: '/internal/deployments/complete',
    });

    expect(completedResponse.statusCode).toBe(404);
  });
  it('rejects late Kubernetes preparation after archiving an in-flight build', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);
    const deployment: DeploymentSummary = requireDeployResponseDeployment(
      deployResponseSchema.parse((await injectDeployRequest(app, installPayload.sessionToken, 'acme-dev')).json()),
    );
    await claimNextQueuedDeployment(app);
    const [project] = await db.select({ id: projects.id }).from(projects).where(eq(projects.name, 'smoke-web'));
    await db
      .update(projectKubeProvisioning)
      .set({ state: 'succeeded' })
      .where(eq(projectKubeProvisioning.projectId, project?.id ?? ''));

    const archiveResponse: LightMyRequestResponse = await app.inject({
      method: 'POST',
      url: '/v1/projects/smoke-web/archive',
      headers: buildOrganizationAuthorizationHeaders(installPayload.sessionToken),
    });
    expect(archiveResponse.statusCode).toBe(200);

    const prepareResponse: LightMyRequestResponse = await app.inject({
      headers: { authorization: 'Bearer test-runtime-control-token' },
      method: 'POST',
      payload: {
        deploymentId: deployment.id,
        deploymentName: 'app-smoke-web',
        imageRef: 'registry.example.test/smoke-web@sha256:late',
        namespace: 'cpt-prj-smoke-web',
        networkPolicyNames: [],
        routeHost: `smoke-web.${defaultApiConfig.baseDomain}`,
        serviceName: 'app-smoke-web',
      },
      url: '/internal/kube-deployments/desired',
    });

    expect(prepareResponse.statusCode).toBe(409);
    expect(errorResponseSchema.parse(prepareResponse.json()).error.code).toBe('project_archived');
    expect(
      await db.select().from(deploymentKubeReferences).where(eq(deploymentKubeReferences.deploymentId, deployment.id)),
    ).toEqual([]);
    await expect(findNextDeploymentReconcilePair()).resolves.toBeNull();

    const storedDeployment: StoredDeploymentRow | undefined = await db.query.deployments.findFirst({
      where: eq(deployments.id, deployment.id),
    });
    expect(storedDeployment).toMatchObject({ status: 'failed' });
    expect(storedDeployment?.failureMessage).toContain('could not be activated because the project was archived');
    expect(storedDeployment?.completedAt).not.toBeNull();
    const storedOperation: StoredOperationRow | undefined = await db.query.operations.findFirst({
      where: eq(operations.id, deployment.operation.id),
    });
    expect(storedOperation?.status).toBe('failed');
    const storedArtifact: StoredBuildArtifactRow | undefined = await db.query.buildArtifacts.findFirst({
      where: eq(buildArtifacts.id, storedDeployment?.buildArtifactId ?? ''),
    });
    expect(storedArtifact).toMatchObject({
      imageRef: 'registry.example.test/smoke-web@sha256:late',
      imageRetentionState: 'available',
    });
    const sourceArchiveResponse: LightMyRequestResponse = await fetchArtifactSourceArchive(
      app,
      storedDeployment?.buildArtifactId ?? '',
    );
    expect(sourceArchiveResponse.statusCode).toBe(404);
  });

  it('deletes the source archive when the worker fails a claimed deployment before any image is produced', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);

    const deployResponse: LightMyRequestResponse = await injectDeployRequest(
      app,
      installPayload.sessionToken,
      'acme-dev',
    );
    expect(deployResponse.statusCode).toBe(200);
    const deployPayload: DeployResponse = deployResponseSchema.parse(deployResponse.json());
    const deployment: DeploymentSummary = requireDeployResponseDeployment(deployPayload);

    const claimedDeployment: WorkerClaimedDeployment = requireClaimedDeployment(await claimNextQueuedDeployment(app));
    expect(claimedDeployment.deploymentId).toBe(deployment.id);

    const failedResponse: LightMyRequestResponse = await app.inject({
      headers: {
        authorization: 'Bearer test-runtime-control-token',
      },
      method: 'POST',
      payload: {
        deploymentId: deployment.id,
        message: 'build failed before image publish',
      },
      url: '/internal/deployments/fail',
    });
    expect(failedResponse.statusCode).toBe(200);

    const statusResponse: LightMyRequestResponse = await app.inject({
      method: 'GET',
      url: '/v1/deployments/status?projectName=smoke-web',
      headers: {
        authorization: `Bearer ${installPayload.sessionToken}`,
        [compartmentCurrentOrganizationHeaderName]: 'acme-dev',
      },
    });
    expect(statusResponse.statusCode).toBe(200);
    const statusPayload: DeploymentStatusResponse = deploymentStatusResponseSchema.parse(statusResponse.json());
    expect(requireSingleDeployment(statusPayload.deployments).status).toBe('failed');

    const sourceArchiveResponse: LightMyRequestResponse = await fetchArtifactSourceArchive(
      app,
      claimedDeployment.artifact.id,
    );
    expect(sourceArchiveResponse.statusCode).toBe(404);
  });
  it('keeps a project archived and retries runtime teardown after a failed archive stop', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);

    const deployPayload: DeployResponse = deployResponseSchema.parse(
      (await injectDeployRequest(app, installPayload.sessionToken, 'acme-dev')).json(),
    );
    const deployment: DeploymentSummary = requireDeployResponseDeployment(deployPayload);
    await completeQueuedDeployment(app, deployment.id);

    projectLifecycleKubeStopServiceMockState.failure = new Error('Kubernetes stop failed.');
    const failedArchiveResponse: LightMyRequestResponse = await app.inject({
      method: 'POST',
      url: '/v1/projects/smoke-web/archive',
      headers: {
        authorization: `Bearer ${installPayload.sessionToken}`,
        [compartmentCurrentOrganizationHeaderName]: 'acme-dev',
      },
    });
    expect(failedArchiveResponse.statusCode).toBe(502);

    const archivedListResponse: LightMyRequestResponse = await app.inject({
      method: 'GET',
      url: '/v1/projects?archiveState=all',
      headers: {
        authorization: `Bearer ${installPayload.sessionToken}`,
        [compartmentCurrentOrganizationHeaderName]: 'acme-dev',
      },
    });
    expect(archivedListResponse.statusCode).toBe(200);
    const archivedListPayload: ProjectListResponse = projectListResponseSchema.parse(archivedListResponse.json());
    if (archivedListPayload.detail !== 'summary') {
      throw new Error('Expected summary project list.');
    }
    expect(archivedListPayload.projects[0]?.archivedAt).not.toBeNull();

    const activeListResponse: LightMyRequestResponse = await app.inject({
      method: 'GET',
      url: '/v1/projects',
      headers: {
        authorization: `Bearer ${installPayload.sessionToken}`,
        [compartmentCurrentOrganizationHeaderName]: 'acme-dev',
      },
    });
    expect(activeListResponse.statusCode).toBe(200);
    expect(projectListResponseSchema.parse(activeListResponse.json()).projects).toHaveLength(0);

    const archivedShowResponse: LightMyRequestResponse = await app.inject({
      method: 'GET',
      url: '/v1/projects/smoke-web',
      headers: {
        authorization: `Bearer ${installPayload.sessionToken}`,
        [compartmentCurrentOrganizationHeaderName]: 'acme-dev',
      },
    });
    expect(archivedShowResponse.statusCode).toBe(409);

    projectLifecycleKubeStopServiceMockState.failure = null;
    const retriedArchiveResponsePromise: Promise<LightMyRequestResponse> = app.inject({
      method: 'POST',
      url: '/v1/projects/smoke-web/archive',
      headers: {
        authorization: `Bearer ${installPayload.sessionToken}`,
        [compartmentCurrentOrganizationHeaderName]: 'acme-dev',
      },
    });
    await acknowledgeKubeDeploymentStopped(deployment.id);
    const retriedArchiveResponse: LightMyRequestResponse = await retriedArchiveResponsePromise;
    expect(retriedArchiveResponse.statusCode).toBe(200);

    const storedDeployments: StoredDeploymentRow[] = await db.select().from(deployments);
    expect(storedDeployments[0]?.isActive).toBe(false);
    expect(storedDeployments[0]?.health).toBe('healthy');
    expect(storedDeployments[0]?.promotionStage).toBe('stopped');
    expect(storedDeployments[0]?.status).toBe('stopped');
  });
});

async function deleteArchivedProject(sessionToken: string): Promise<LightMyRequestResponse> {
  const deletion: LightMyRequestResponse = await app.inject({
    method: 'DELETE',
    url: '/v1/projects/smoke-web',
    headers: buildOrganizationAuthorizationHeaders(sessionToken),
  });
  expect(deletion.statusCode).toBe(200);
  await expect(
    db.select({ id: projects.id }).from(projects).where(eq(projects.name, 'smoke-web')),
  ).resolves.toHaveLength(1);
  const teardown: ProjectProvisioningClaimRow = await waitForProjectTeardownClaim();
  await completeProjectProvisioning({
    action: 'teardown',
    failureMessage: null,
    isolationVersion: teardown.isolationVersion,
    leaseId: teardown.leaseId,
    projectId: teardown.projectId,
    status: 'succeeded',
  });
  return deletion;
}

async function waitForDatabaseBlocker(client: PoolClient): Promise<void> {
  const deadline: number = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const result: { rows: { blockedCount: number }[] } = await client.query(
      `select count(*)::int as "blockedCount"
       from pg_stat_activity activity
       where activity.datname = current_database()
         and pg_backend_pid() = any(pg_blocking_pids(activity.pid))`,
    );
    if ((result.rows[0]?.blockedCount ?? 0) >= 1) {
      return;
    }
    await new Promise<void>((resolve: () => void): NodeJS.Timeout => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for the concurrent session to block on the project archive transaction.');
}

async function waitForProjectTeardownClaim(): Promise<ProjectProvisioningClaimRow> {
  for (let attempt: number = 0; attempt < 100; attempt += 1) {
    const claimed: ProjectProvisioningClaimRow | null = await claimPendingProjectProvisioning();
    if (claimed?.action === 'teardown') {
      return claimed;
    }
    await new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, 10);
    });
  }
  throw new Error('Timed out waiting for project teardown claim.');
}

async function prepareKubeLifecycleDeployment(
  state: Extract<DeploymentKubeState, 'desired' | 'pending'>,
  activateDeployment: boolean,
): Promise<PreparedKubeLifecycleDeployment> {
  const installPayload: InstallResponse = await installCompartment(app);
  const deployment: DeploymentSummary = requireDeployResponseDeployment(
    deployResponseSchema.parse((await injectDeployRequest(app, installPayload.sessionToken, 'acme-dev')).json()),
  );
  if (activateDeployment) {
    await completeQueuedDeployment(app, deployment.id);
  } else {
    await claimNextQueuedDeployment(app);
  }
  const projectId: string =
    (await db.select({ id: projects.id }).from(projects).where(eq(projects.name, 'smoke-web')).limit(1))[0]?.id ?? '';
  if (activateDeployment) {
    await db
      .update(projectKubeProvisioning)
      .set({ state: 'succeeded' })
      .where(eq(projectKubeProvisioning.projectId, projectId));
  }
  if (activateDeployment) {
    await db
      .update(deploymentKubeReferences)
      .set({ state })
      .where(eq(deploymentKubeReferences.deploymentId, deployment.id));
  } else {
    await db.insert(deploymentKubeReferences).values({
      deploymentId: deployment.id,
      deploymentName: 'app-smoke-web',
      id: `kref_${state}_lifecycle`,
      namespace: 'cpt-prj-smoke-web',
      networkPolicyNamesJson: '[]',
      serviceName: 'app-smoke-web',
      state,
    });
  }
  return { deployment, installPayload, projectId };
}

function createUnbootstrappedResourceDescriptor(): CompartmentAuthoredDescriptorInput {
  return {
    name: 'smoke-web',
    resources: {
      postgres: {
        image: 'postgres:16',
        ports: [5432],
        volumes: { data: '/var/lib/postgresql/data' },
      },
    },
    services: { web: './services/web' },
  };
}

function createUnbootstrappedResourceIntent(
  resource: typeof projectResources.$inferSelect,
  project: typeof projects.$inferSelect,
): ResourceReconcileIntent {
  return {
    command: [],
    deleteData: false,
    environmentId: resource.environmentId,
    env: {},
    image: resource.image,
    namespaceId: project.id,
    operation: 'reconcile',
    ports: [5432],
    readiness: null,
    replicas: 1,
    resourceId: resource.id,
    secretId: resource.id,
    volumes: [{ mountPath: '/var/lib/postgresql/data', size: '1Gi', volumeHandle: 'data' }],
  };
}
