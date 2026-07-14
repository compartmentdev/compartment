import type { LightMyRequestResponse } from 'fastify';
import type * as CompartmentSdk from '@compartment/sdk';
import {
  accessGroupListResponseSchema,
  accessGroupResponseSchema,
  accessRoleListResponseSchema,
  accessRoleResponseSchema,
  buildCompartmentProjectApiPathname,
  buildCompartmentProjectArchiveApiPathname,
  compartmentAssignmentsPathname,
  compartmentDeploymentRunLogsPathname,
  compartmentGitHubProviderBootstrapPathname,
  compartmentGroupsPathname,
  compartmentRolesPathname,
  compartmentSourcesPathname,
  customDomainResponseSchema,
  deploymentRunLogsResponseSchema,
  deployResponseSchema,
  deploymentInspectResponseSchema,
  errorResponseSchema,
  resourceListResponseSchema,
  resourceLogsResponseSchema,
  resourceOutputResponseSchema,
  resourceResponseSchema,
  gitHubProviderBootstrapResponseSchema,
  gitSourceListResponseSchema,
  projectReadResponseSchema,
  projectResponseSchema,
  type DeploymentRunLogsResponse,
  type DeployResponse,
  type NodeInspectDeploymentResponse,
  type ProductLogIngestEvent,
  type InstallResponse,
} from '@compartment/contracts';
import { immutableKubeName } from '@compartment/utils';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { createApp } from '../src/app';
import type { ApiApp } from '../src/app.types';
import {
  buildArtifacts,
  deploymentCustomDomains,
  deploymentRunEvents,
  deploymentRuns,
  deployments,
  environments,
  operations,
  projectResources,
  projectServices,
  projects,
  variableAccessEvents,
} from '../src/db/schema';
import {
  buildOrganizationAuthorizationHeaders,
  completeQueuedDeployment,
  createDeployDescriptor,
  injectDeployRequest,
  installCompartment,
  registerLocalNode,
} from './api-integration.harness';
import {
  createRbacTestHarness,
  ensureRbacTestHarness,
  findRoleIdByName,
  resetRbacTestHarness,
  seedAssignment,
  seedCustomRole,
  seedEnvironment,
  seedMemberSession,
  seedProject,
  type RbacTestHarness,
} from './rbac-test.fixtures';
import { ingestDeploymentProductLogs } from '../src/services/deployment-product-logs.service';

interface AppAccessEdgeServiceModule {
  invalidateEdgeAppAccessSessions: () => Promise<void>;
  synchronizeEdgeAppAccessState: () => Promise<void>;
}

vi.mock(
  '../src/services/app-access-edge.service',
  (): AppAccessEdgeServiceModule => ({
    invalidateEdgeAppAccessSessions: async (): Promise<void> => await Promise.resolve(),
    synchronizeEdgeAppAccessState: async (): Promise<void> => await Promise.resolve(),
  }),
);

vi.mock('@compartment/sdk', async (): Promise<typeof CompartmentSdk> => {
  const actual: typeof CompartmentSdk = await vi.importActual('@compartment/sdk');

  return {
    ...actual,
    inspectNodeDeployment: async (): Promise<NodeInspectDeploymentResponse> =>
      await Promise.resolve({
        deployment: {
          containerId: 'container_123',
          imageRef: 'sha256:image',
          routeHost: 'billing.localhost',
          upstreamHost: '127.0.0.1',
          upstreamPort: 31000,
        },
      }),
    tailNodeResourceLogs: async (): Promise<{
      lines: {
        message: string;
        resourceName: string;
        stream: 'stdout';
        timestamp: string;
      }[];
    }> =>
      await Promise.resolve({
        lines: [
          {
            message: 'resource ok',
            resourceName: 'postgres',
            stream: 'stdout',
            timestamp: '2026-05-05T00:00:00.000Z',
          },
        ],
      }),
  };
});

interface IdRow {
  id: string;
}

const harness: RbacTestHarness = createRbacTestHarness('api_rbac_permission_families_integration');
const app: ApiApp = createApp({ config: harness.apiConfig, pool: harness.pool });

describe('rbac permission-family integration', (): void => {
  beforeAll(async (): Promise<void> => {
    await ensureRbacTestHarness(harness);
  });

  beforeEach(async (): Promise<void> => {
    await resetRbacTestHarness(harness);
  });

  afterEach((): void => {
    vi.unstubAllGlobals();
  });

  afterAll(async (): Promise<void> => {
    await app.close();
  });

  it('enforces direct project read, archive, and assignment-deletion transitions', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);
    await seedProject(harness, {
      id: 'prj_123',
      name: 'billing',
      organizationId: installPayload.organization.id,
    });
    await seedMemberSession(harness, {
      email: 'viewer@example.com',
      organizationId: installPayload.organization.id,
      principalId: 'prn_viewer',
      sessionToken: 'viewer-session',
    });

    const readonlyAssignmentId: string = 'asg_project_readonly';
    await seedAssignment(harness, {
      id: readonlyAssignmentId,
      organizationId: installPayload.organization.id,
      roleId: await findRoleIdByName(harness, installPayload.organization.id, 'readonly'),
      scopeId: 'prj_123',
      scopeType: 'project',
      subjectId: 'prn_viewer',
      subjectType: 'principal',
    });

    const projectResponse: LightMyRequestResponse = await app.inject({
      headers: buildOrganizationAuthorizationHeaders('viewer-session'),
      method: 'GET',
      url: buildCompartmentProjectApiPathname('billing'),
    });
    const archiveDeniedResponse: LightMyRequestResponse = await app.inject({
      headers: buildOrganizationAuthorizationHeaders('viewer-session'),
      method: 'POST',
      url: buildCompartmentProjectArchiveApiPathname('billing'),
    });

    expect(projectResponse.statusCode).toBe(200);
    expect(projectReadResponseSchema.parse(projectResponse.json()).project.name).toBe('billing');
    expect(archiveDeniedResponse.statusCode).toBe(403);

    const deleteAssignmentResponse: LightMyRequestResponse = await app.inject({
      headers: buildOrganizationAuthorizationHeaders(installPayload.sessionToken),
      method: 'DELETE',
      url: `${compartmentAssignmentsPathname}/${readonlyAssignmentId}`,
    });
    const hiddenProjectResponse: LightMyRequestResponse = await app.inject({
      headers: buildOrganizationAuthorizationHeaders('viewer-session'),
      method: 'GET',
      url: buildCompartmentProjectApiPathname('billing'),
    });

    expect(deleteAssignmentResponse.statusCode).toBe(200);
    expect(hiddenProjectResponse.statusCode).toBe(403);

    await seedCustomRole(harness, {
      id: 'rol_project_archiver',
      name: 'Project Archiver',
      organizationId: installPayload.organization.id,
      permissionKeys: ['project.archive'],
    });
    await seedAssignment(harness, {
      id: 'asg_project_archiver',
      organizationId: installPayload.organization.id,
      roleId: 'rol_project_archiver',
      scopeId: 'prj_123',
      scopeType: 'project',
      subjectId: 'prn_viewer',
      subjectType: 'principal',
    });

    const archiveAllowedResponse: LightMyRequestResponse = await app.inject({
      headers: buildOrganizationAuthorizationHeaders('viewer-session'),
      method: 'POST',
      url: buildCompartmentProjectArchiveApiPathname('billing'),
    });

    expect(archiveAllowedResponse.statusCode).toBe(200);
    expect(projectResponseSchema.parse(archiveAllowedResponse.json()).project.archivedAt).not.toBeNull();
  });

  it('enforces env-scoped inspect and custom-domain permissions', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);
    await registerLocalNode(app);
    const deployResponse: DeployResponse = deployResponseSchema.parse(
      (
        await injectDeployRequest(app, installPayload.sessionToken, installPayload.organization.slug, {
          descriptor: createDeployDescriptor('billing'),
          environmentName: 'production',
        })
      ).json(),
    );
    await completeQueuedDeployment(app, deployResponse.deployments[0]!.id, 'billing.localhost');
    await seedMemberSession(harness, {
      email: 'operator@example.com',
      organizationId: installPayload.organization.id,
      principalId: 'prn_operator',
      sessionToken: 'operator-session',
    });
    const environmentId: string = await findEnvironmentId('billing', 'production');
    await harness.db.insert(deploymentCustomDomains).values({
      createdByPrincipalId: 'prn_operator',
      environmentId,
      host: 'billing.example.com',
      id: 'cdom_123',
      ownershipStatus: 'pending',
      projectServiceId: await findProjectServiceId('billing', 'web'),
      routingStatus: 'pending',
      updatedAt: new Date('2026-05-05T00:00:00.000Z'),
      verificationTokenHash: 'token-hash',
    });
    await seedAssignment(harness, {
      id: 'asg_env_readonly',
      organizationId: installPayload.organization.id,
      roleId: await findRoleIdByName(harness, installPayload.organization.id, 'readonly'),
      scopeId: environmentId,
      scopeType: 'environment',
      subjectId: 'prn_operator',
      subjectType: 'principal',
    });

    const inspectResponse: LightMyRequestResponse = await app.inject({
      headers: buildOrganizationAuthorizationHeaders('operator-session'),
      method: 'GET',
      url: '/v1/deployments/inspect?projectName=billing&environmentName=production',
    });
    const domainListResponse: LightMyRequestResponse = await app.inject({
      headers: buildOrganizationAuthorizationHeaders('operator-session'),
      method: 'GET',
      url: '/v1/domains/billing.example.com',
    });
    const domainDeleteHiddenResponse: LightMyRequestResponse = await app.inject({
      headers: buildOrganizationAuthorizationHeaders('operator-session'),
      method: 'DELETE',
      url: '/v1/domains/billing.example.com',
    });

    expect(inspectResponse.statusCode).toBe(200);
    expect(deploymentInspectResponseSchema.parse(inspectResponse.json()).sensitiveTopologyVisible).toBe(false);
    expect(domainListResponse.statusCode).toBe(200);
    expect(customDomainResponseSchema.parse(domainListResponse.json()).domain.host).toBe('billing.example.com');
    expect(domainDeleteHiddenResponse.statusCode).toBe(404);

    await seedCustomRole(harness, {
      id: 'rol_domain_writer',
      name: 'Domain Writer',
      organizationId: installPayload.organization.id,
      permissionKeys: ['domain.write'],
    });
    await seedAssignment(harness, {
      id: 'asg_domain_writer',
      organizationId: installPayload.organization.id,
      roleId: 'rol_domain_writer',
      scopeId: environmentId,
      scopeType: 'environment',
      subjectId: 'prn_operator',
      subjectType: 'principal',
    });

    const domainCreateResponse: LightMyRequestResponse = await app.inject({
      headers: buildOrganizationAuthorizationHeaders('operator-session'),
      method: 'DELETE',
      url: '/v1/domains/billing.example.com',
    });

    expect(domainCreateResponse.statusCode).toBe(200);
    expect(domainCreateResponse.json()).toEqual({ host: 'billing.example.com', removed: true });
  });

  it('resolves resource access at environment scope and keeps resource logs behind explicit log-read grants', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);
    await seedProject(harness, {
      id: 'prj_resource',
      name: 'billing',
      organizationId: installPayload.organization.id,
    });
    await seedEnvironment(harness, {
      id: 'env_resource',
      name: 'production',
      projectId: 'prj_resource',
    });
    await harness.db.insert(projectResources).values({
      commandJson: '[]',
      containerId: 'container_resource',
      envJson: '[]',
      environmentId: 'env_resource',
      hostname: 'postgres.production.billing.resource.internal',
      id: 'res_postgres',
      image: 'postgres:16',
      name: 'postgres',
      outputsJson: '{"connection-url":{"sensitive":true,"value":"postgres://${resource.host}/app"}}',
      portsJson: '[5432]',
      readinessJson: '{"type":"tcp","port":5432,"timeoutMs":30000}',
      restartPolicy: 'on-failure',
      runtimeDefinitionHash: 'hash_resource',
      status: 'running',
      updatedAt: new Date('2026-05-05T00:00:00.000Z'),
      volumesJson: '[]',
    });
    await seedMemberSession(harness, {
      email: 'operator@example.com',
      organizationId: installPayload.organization.id,
      principalId: 'prn_operator',
      sessionToken: 'operator-session',
    });
    await seedCustomRole(harness, {
      id: 'rol_resource_deployer',
      name: 'Resource Deployer',
      organizationId: installPayload.organization.id,
      permissionKeys: ['deployment.create'],
    });
    await seedAssignment(harness, {
      id: 'asg_resource_deployer',
      organizationId: installPayload.organization.id,
      roleId: 'rol_resource_deployer',
      scopeId: 'env_resource',
      scopeType: 'environment',
      subjectId: 'prn_operator',
      subjectType: 'principal',
    });

    const listResponse: LightMyRequestResponse = await app.inject({
      headers: buildOrganizationAuthorizationHeaders('operator-session'),
      method: 'GET',
      url: '/v1/resources?projectName=billing&environmentName=production',
    });
    const resourceResponse: LightMyRequestResponse = await app.inject({
      headers: buildOrganizationAuthorizationHeaders('operator-session'),
      method: 'GET',
      url: '/v1/resources/postgres?projectName=billing&environmentName=production',
    });
    const deniedLogsResponse: LightMyRequestResponse = await app.inject({
      headers: buildOrganizationAuthorizationHeaders('operator-session'),
      method: 'GET',
      url: '/v1/resources/postgres/logs?projectName=billing&environmentName=production',
    });
    const hiddenOutputResponse: LightMyRequestResponse = await app.inject({
      headers: buildOrganizationAuthorizationHeaders('operator-session'),
      method: 'GET',
      url: '/v1/resources/postgres/outputs/connection-url?projectName=billing&environmentName=production',
    });
    const revealFalseOutputResponse: LightMyRequestResponse = await app.inject({
      headers: buildOrganizationAuthorizationHeaders('operator-session'),
      method: 'GET',
      url: '/v1/resources/postgres/outputs/connection-url?projectName=billing&environmentName=production&reveal=false',
    });
    const deniedRevealOutputResponse: LightMyRequestResponse = await app.inject({
      headers: buildOrganizationAuthorizationHeaders('operator-session'),
      method: 'GET',
      url: '/v1/resources/postgres/outputs/connection-url?projectName=billing&environmentName=production&reveal=true',
    });

    expect(listResponse.statusCode).toBe(200);
    expect(resourceListResponseSchema.parse(listResponse.json()).resources).toHaveLength(1);
    expect(resourceResponse.statusCode).toBe(200);
    expect(resourceResponseSchema.parse(resourceResponse.json()).resource.name).toBe('postgres');
    expect(hiddenOutputResponse.statusCode).toBe(200);
    expect(resourceOutputResponseSchema.parse(hiddenOutputResponse.json()).output.value).toBeNull();
    expect(revealFalseOutputResponse.statusCode).toBe(200);
    expect(resourceOutputResponseSchema.parse(revealFalseOutputResponse.json()).output.value).toBeNull();
    expect(deniedRevealOutputResponse.statusCode).toBe(403);
    expect(deniedLogsResponse.statusCode).toBe(403);

    await seedCustomRole(harness, {
      id: 'rol_resource_output_reveal',
      name: 'Resource Output Reveal',
      organizationId: installPayload.organization.id,
      permissionKeys: ['variable.value.read'],
    });
    await seedAssignment(harness, {
      id: 'asg_resource_output_reveal',
      organizationId: installPayload.organization.id,
      roleId: 'rol_resource_output_reveal',
      scopeId: 'env_resource',
      scopeType: 'environment',
      subjectId: 'prn_operator',
      subjectType: 'principal',
    });
    await seedCustomRole(harness, {
      id: 'rol_resource_logs',
      name: 'Resource Logs',
      organizationId: installPayload.organization.id,
      permissionKeys: ['deployment.logs.read'],
    });
    await seedAssignment(harness, {
      id: 'asg_resource_logs',
      organizationId: installPayload.organization.id,
      roleId: 'rol_resource_logs',
      scopeId: 'env_resource',
      scopeType: 'environment',
      subjectId: 'prn_operator',
      subjectType: 'principal',
    });

    const allowedLogsResponse: LightMyRequestResponse = await app.inject({
      headers: buildOrganizationAuthorizationHeaders('operator-session'),
      method: 'GET',
      url: '/v1/resources/postgres/logs?projectName=billing&environmentName=production',
    });
    const revealOutputResponse: LightMyRequestResponse = await app.inject({
      headers: buildOrganizationAuthorizationHeaders('operator-session'),
      method: 'GET',
      url: '/v1/resources/postgres/outputs/connection-url?projectName=billing&environmentName=production&reveal=true',
    });

    expect(allowedLogsResponse.statusCode).toBe(200);
    expect(resourceLogsResponseSchema.parse(allowedLogsResponse.json()).lines[0]?.message).toBe('resource ok');
    await harness.db
      .update(projectResources)
      .set({ runtimeKind: 'kubernetes' })
      .where(eq(projectResources.id, 'res_postgres'));
    const resourceEvent: ProductLogIngestEvent = {
      containerName: 'resource',
      message: 'database system is ready',
      namespace: immutableKubeName('cpt', 'prj_resource'),
      podName: `${immutableKubeName('resource', 'res_postgres')}-abc`,
      podUid: '34343434-3434-4434-8434-343434343434',
      restartIdentity: '0',
      sourceFingerprint: 'd'.repeat(64),
      sourceOffset: 1,
      stream: 'stderr',
      timestamp: new Date().toISOString(),
    };
    await ingestDeploymentProductLogs([resourceEvent]);
    const kubernetesLogsResponse: LightMyRequestResponse = await app.inject({
      headers: buildOrganizationAuthorizationHeaders('operator-session'),
      method: 'GET',
      url: '/v1/resources/postgres/logs?projectName=billing&environmentName=production',
    });
    expect(kubernetesLogsResponse.statusCode).toBe(200);
    expect(resourceLogsResponseSchema.parse(kubernetesLogsResponse.json()).lines[0]?.message).toBe(
      'database system is ready',
    );
    expect(revealOutputResponse.statusCode).toBe(200);
    expect(resourceOutputResponseSchema.parse(revealOutputResponse.json()).output.value).toBe(
      'postgres://postgres.production.billing.resource.internal/app',
    );
    const accessEvents: (typeof variableAccessEvents.$inferSelect)[] = await harness.db
      .select()
      .from(variableAccessEvents);
    expect(accessEvents).toEqual([
      expect.objectContaining({
        environmentId: 'env_resource',
        operation: 'resource_output_reveal',
        projectId: 'prj_resource',
        targetEnvironmentName: 'production',
        targetProjectName: 'billing',
        targetResourceName: 'postgres',
        targetServiceName: null,
      }),
    ]);
    expect(JSON.parse(accessEvents[0]!.keyNamesJson)).toEqual(['connection-url']);
    expect(JSON.parse(accessEvents[0]!.sensitivityJson)).toEqual({ 'connection-url': 'sensitive' });
    expect(Object.keys(JSON.parse(accessEvents[0]!.fingerprintsJson) as Record<string, string>)).toEqual([
      'connection-url',
    ]);
    expect(JSON.stringify(accessEvents)).not.toContain('postgres://postgres.production.billing.resource.internal/app');
  });

  it('hides explicit deployment run logs without log-read permission', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);
    await seedDeploymentRunLogsFixture(installPayload.organization.id);
    await seedMemberSession(harness, {
      email: 'operator@example.com',
      organizationId: installPayload.organization.id,
      principalId: 'prn_operator',
      sessionToken: 'operator-session',
    });
    await seedCustomRole(harness, {
      id: 'rol_deployment_reader',
      name: 'Deployment Reader',
      organizationId: installPayload.organization.id,
      permissionKeys: ['project.read', 'deployment.read'],
    });
    await seedAssignment(harness, {
      id: 'asg_deployment_reader',
      organizationId: installPayload.organization.id,
      roleId: 'rol_deployment_reader',
      scopeId: 'prj_run_logs',
      scopeType: 'project',
      subjectId: 'prn_operator',
      subjectType: 'principal',
    });

    const existingRunResponse: LightMyRequestResponse = await app.inject({
      headers: buildOrganizationAuthorizationHeaders('operator-session'),
      method: 'GET',
      url: `${compartmentDeploymentRunLogsPathname}?projectName=billing&selector=run&deploymentRunId=drn_run_logs`,
    });
    const missingRunResponse: LightMyRequestResponse = await app.inject({
      headers: buildOrganizationAuthorizationHeaders('operator-session'),
      method: 'GET',
      url: `${compartmentDeploymentRunLogsPathname}?projectName=billing&selector=run&deploymentRunId=drn_missing`,
    });

    expect(existingRunResponse.statusCode).toBe(404);
    expect(errorResponseSchema.parse(existingRunResponse.json()).error.code).toBe('deployment_not_found');
    expect(missingRunResponse.statusCode).toBe(404);
    expect(errorResponseSchema.parse(missingRunResponse.json()).error.code).toBe('deployment_not_found');

    await seedCustomRole(harness, {
      id: 'rol_deployment_logs',
      name: 'Deployment Logs',
      organizationId: installPayload.organization.id,
      permissionKeys: ['deployment.logs.read'],
    });
    await seedAssignment(harness, {
      id: 'asg_deployment_logs',
      organizationId: installPayload.organization.id,
      roleId: 'rol_deployment_logs',
      scopeId: 'env_run_logs',
      scopeType: 'environment',
      subjectId: 'prn_operator',
      subjectType: 'principal',
    });

    const allowedResponse: LightMyRequestResponse = await app.inject({
      headers: buildOrganizationAuthorizationHeaders('operator-session'),
      method: 'GET',
      url: `${compartmentDeploymentRunLogsPathname}?projectName=billing&selector=run&deploymentRunId=drn_run_logs`,
    });

    expect(allowedResponse.statusCode, allowedResponse.body).toBe(200);
    const allowedPayload: DeploymentRunLogsResponse = deploymentRunLogsResponseSchema.parse(allowedResponse.json());
    expect(allowedPayload.deployment.id).toBe('drn_run_logs');
    expect(allowedPayload.lines[0]?.message).toBe('run log exists');
  });

  it('enforces org-scoped source, group, and role read/manage permissions', async (): Promise<void> => {
    const installPayload: InstallResponse = await installCompartment(app);
    await seedMemberSession(harness, {
      email: 'reader@example.com',
      organizationId: installPayload.organization.id,
      principalId: 'prn_reader',
      sessionToken: 'reader-session',
    });
    await seedCustomRole(harness, {
      id: 'rol_org_reader',
      name: 'Organization Reader',
      organizationId: installPayload.organization.id,
      permissionKeys: ['organization.group.read', 'organization.role.read', 'source.read'],
    });
    await seedAssignment(harness, {
      id: 'asg_org_reader',
      organizationId: installPayload.organization.id,
      roleId: 'rol_org_reader',
      scopeId: installPayload.organization.id,
      scopeType: 'organization',
      subjectId: 'prn_reader',
      subjectType: 'principal',
    });

    expect(
      (
        await app.inject({
          headers: buildOrganizationAuthorizationHeaders('reader-session'),
          method: 'GET',
          url: compartmentGroupsPathname,
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          headers: buildOrganizationAuthorizationHeaders('reader-session'),
          method: 'GET',
          url: compartmentRolesPathname,
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          headers: buildOrganizationAuthorizationHeaders('reader-session'),
          method: 'GET',
          url: compartmentSourcesPathname,
        })
      ).statusCode,
    ).toBe(200);
    expect(
      accessGroupListResponseSchema.parse(
        (
          await app.inject({
            headers: buildOrganizationAuthorizationHeaders('reader-session'),
            method: 'GET',
            url: compartmentGroupsPathname,
          })
        ).json(),
      ).groups,
    ).toEqual([]);
    expect(
      accessRoleListResponseSchema.parse(
        (
          await app.inject({
            headers: buildOrganizationAuthorizationHeaders('reader-session'),
            method: 'GET',
            url: compartmentRolesPathname,
          })
        ).json(),
      ).roles.length,
    ).toBeGreaterThan(0);
    expect(
      gitSourceListResponseSchema.parse(
        (
          await app.inject({
            headers: buildOrganizationAuthorizationHeaders('reader-session'),
            method: 'GET',
            url: compartmentSourcesPathname,
          })
        ).json(),
      ).sources,
    ).toEqual([]);

    expect(
      (
        await app.inject({
          headers: buildOrganizationAuthorizationHeaders('reader-session'),
          method: 'POST',
          payload: { name: 'Operators' },
          url: compartmentGroupsPathname,
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          headers: buildOrganizationAuthorizationHeaders('reader-session'),
          method: 'POST',
          payload: { name: 'Project Operator', permissionKeys: ['project.read'] },
          url: compartmentRolesPathname,
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          headers: buildOrganizationAuthorizationHeaders('reader-session'),
          method: 'POST',
          payload: {
            providerHost: 'github.com',
            repositoryOwner: 'acme',
          },
          url: compartmentGitHubProviderBootstrapPathname,
        })
      ).statusCode,
    ).toBe(403);

    await seedCustomRole(harness, {
      id: 'rol_org_manager',
      name: 'Organization Manager',
      organizationId: installPayload.organization.id,
      permissionKeys: ['organization.group.manage', 'organization.role.manage', 'project.read', 'source.manage'],
    });
    await seedAssignment(harness, {
      id: 'asg_org_manager',
      organizationId: installPayload.organization.id,
      roleId: 'rol_org_manager',
      scopeId: installPayload.organization.id,
      scopeType: 'organization',
      subjectId: 'prn_reader',
      subjectType: 'principal',
    });

    const groupCreateResponse: LightMyRequestResponse = await app.inject({
      headers: buildOrganizationAuthorizationHeaders('reader-session'),
      method: 'POST',
      payload: { name: 'Operators' },
      url: compartmentGroupsPathname,
    });
    const roleCreateResponse: LightMyRequestResponse = await app.inject({
      headers: buildOrganizationAuthorizationHeaders('reader-session'),
      method: 'POST',
      payload: { name: 'Project Operator', permissionKeys: ['project.read'] },
      url: compartmentRolesPathname,
    });
    const bootstrapResponse: LightMyRequestResponse = await app.inject({
      headers: buildOrganizationAuthorizationHeaders('reader-session'),
      method: 'POST',
      payload: {
        providerHost: 'github.com',
        repositoryOwner: 'acme',
      },
      url: compartmentGitHubProviderBootstrapPathname,
    });

    expect(groupCreateResponse.statusCode).toBe(200);
    expect(accessGroupResponseSchema.parse(groupCreateResponse.json()).group.name).toBe('Operators');
    expect(roleCreateResponse.statusCode).toBe(200);
    expect(accessRoleResponseSchema.parse(roleCreateResponse.json()).role.name).toBe('Project Operator');
    expect(bootstrapResponse.statusCode).toBe(200);
    expect(gitHubProviderBootstrapResponseSchema.parse(bootstrapResponse.json()).providerHost).toBe('github.com');
  });
});

async function seedDeploymentRunLogsFixture(organizationId: string): Promise<void> {
  const now: Date = new Date('2026-05-05T00:00:00.000Z');

  await seedProject(harness, {
    id: 'prj_run_logs',
    name: 'billing',
    organizationId,
  });
  await seedEnvironment(harness, {
    id: 'env_run_logs',
    name: 'production',
    projectId: 'prj_run_logs',
  });
  await harness.db.insert(projectServices).values({
    id: 'svc_run_logs',
    kind: 'web',
    name: 'web',
    path: '.',
    projectId: 'prj_run_logs',
    updatedAt: now,
  });
  await harness.db.insert(buildArtifacts).values({
    id: 'bar_run_logs',
    imageRepository: 'repo/run-logs',
    projectId: 'prj_run_logs',
    projectServiceId: 'svc_run_logs',
    resolvedBuildEnvJson: '{}',
    resolvedBuildJson: '{"env":[],"include":[],"packages":{"build":[],"runtime":[]},"strategy":"auto"}',
    sourceDigest: 'sha256:run-logs',
    updatedAt: now,
  });
  await harness.db.insert(operations).values({
    id: 'op_run_logs',
    status: 'succeeded',
    summary: 'Deployed app',
    targetId: 'dep_run_logs',
    targetType: 'deployment',
    type: 'deployment.create',
  });
  await harness.db.insert(deploymentRuns).values({
    environmentId: 'env_run_logs',
    id: 'drn_run_logs',
    label: null,
    triggerType: 'manual',
    updatedAt: now,
  });
  await harness.db.insert(deployments).values({
    accessMode: 'authenticated',
    buildArtifactId: 'bar_run_logs',
    completedAt: now,
    deploymentRunId: 'drn_run_logs',
    environmentId: 'env_run_logs',
    health: 'healthy',
    id: 'dep_run_logs',
    isActive: true,
    nodeId: 'nod_local',
    operationId: 'op_run_logs',
    projectServiceId: 'svc_run_logs',
    promotionStage: 'active',
    resolvedReadinessJson: 'null',
    resolvedRoutesJson: '[]',
    resolvedRunJson: '{"restart":{"policy":"on-failure"}}',
    status: 'succeeded',
    updatedAt: now,
  });
  await harness.db.insert(deploymentRunEvents).values({
    createdAt: now,
    deploymentId: 'dep_run_logs',
    deploymentRunId: 'drn_run_logs',
    id: 'dre_run_logs',
    level: 'info',
    message: 'run log exists',
    status: 'succeeded',
    stepKey: 'release',
    stream: 'stdout',
  });
}

async function findEnvironmentId(projectName: string, environmentName: string): Promise<string> {
  const rows: IdRow[] = await harness.db
    .select({ id: environments.id })
    .from(environments)
    .innerJoin(projects, eq(projects.id, environments.projectId))
    .where(and(eq(projects.name, projectName), eq(environments.name, environmentName)));
  const environment: IdRow | undefined = rows[0];
  if (environment === undefined) {
    throw new Error(`Missing environment ${projectName}/${environmentName}.`);
  }

  return environment.id;
}

async function findProjectServiceId(projectName: string, serviceName: string): Promise<string> {
  const rows: IdRow[] = await harness.db
    .select({ id: projectServices.id })
    .from(projectServices)
    .innerJoin(projects, eq(projects.id, projectServices.projectId))
    .where(and(eq(projects.name, projectName), eq(projectServices.name, serviceName)));
  const service: IdRow | undefined = rows[0];
  if (service === undefined) {
    throw new Error(`Missing service ${projectName}/${serviceName}.`);
  }

  return service.id;
}
