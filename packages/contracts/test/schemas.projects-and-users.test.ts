import { describe, expect, it } from 'vitest';
import type { SafeParseReturnType } from 'zod';

import {
  compartmentProjectNameSchema,
  deploymentLogsResponseSchema,
  deploymentInspectResponseSchema,
  nodeInspectDeploymentQuerySchema,
  projectDeleteResponseSchema,
  projectListQuerySchema,
  projectListResponseSchema,
  projectStatusListResponseSchema,
  projectShowResponseSchema,
  type DeploymentInspectResponse,
  type DeploymentInspectTarget,
  type DeploymentLogsResponse,
  type NodeInspectDeploymentQuery,
  type ProjectDeleteResponse,
  type ProjectListQuery,
  type ProjectListResponse,
  type ProjectShowResponse,
  type ProjectStatusListResponse,
  type UserListQuery,
  type UserListResponse,
  type WorkerClaimDeploymentResponse,
  type WorkerClaimedDeployment,
  type WorkerRecoverDeploymentsQuery,
  type WorkerRecoverDeploymentsResponse,
  userListQuerySchema,
  userListResponseSchema,
  workerClaimDeploymentResponseSchema,
  workerRecoverDeploymentsQuerySchema,
  workerRecoverDeploymentsResponseSchema,
} from '../src';
import type { RuntimePreviousDeployment } from '../src/contracts/runtime-shared.contract';
import {
  buildDeploymentInspectResponse,
  buildDeploymentInspectTarget,
  buildProjectOverviewSummary,
  buildProjectStatusSummary,
  buildProjectSummary,
} from './schema-test.fixtures';
import { expectPresent } from './schema-test.helpers';

interface ContractListPaginationPayload {
  page: number;
  perPage: number;
  totalItems: number;
  totalPages: number;
}

interface ContractProjectSummaryPayload {
  archivedAt: string | null;
  createdAt: string;
  id: string;
  name: string;
  organizationId: string;
  updatedAt: string;
}

interface ProjectOverviewListResponseWithSummaryRowsPayload {
  detail: 'overview';
  pagination: ContractListPaginationPayload;
  projects: ContractProjectSummaryPayload[];
}

describe('contract schemas projects and users', (): void => {
  it('accepts readonly-safe deployment logs payloads', (): void => {
    const result: DeploymentLogsResponse = deploymentLogsResponseSchema.parse({
      deployments: [
        {
          completedAt: '2026-03-24T10:00:00.000Z',
          createdAt: '2026-03-24T09:00:00.000Z',
          deploymentRunId: 'drn_123',
          failureMessage: null,
          health: 'healthy',
          id: 'dep_123',
          isActive: true,
          label: null,
          operation: {
            completedAt: '2026-03-24T10:00:00.000Z',
            createdAt: '2026-03-24T09:00:00.000Z',
            status: 'succeeded',
            type: 'deployment.create',
          },
          promotionStage: 'active',
          rollbackAvailable: false,
          routeUrl: 'https://smoke-web.example.com',
          serviceName: 'web',
          status: 'running',
        },
      ],
      environment: {
        name: 'production',
      },
      lines: [
        {
          deploymentId: 'dep_123',
          environmentName: 'production',
          message: 'runtime ok',
          serviceName: 'web',
          stream: 'stdout',
          timestamp: '2026-03-24T10:00:01.000Z',
        },
      ],
      project: {
        name: 'smoke-web',
      },
    });

    expect(expectPresent(result.lines[0], 'log line').message).toBe('runtime ok');
  });

  it('accepts project delete payloads with a canonical project slug', (): void => {
    const result: ProjectDeleteResponse = projectDeleteResponseSchema.parse({
      projectName: 'smoke-web',
    });

    expect(result.projectName).toBe('smoke-web');
  });

  it('rejects project slugs reserved for browser routes', (): void => {
    const result: SafeParseReturnType<string, string> = compartmentProjectNameSchema.safeParse('create');

    expect(result.success).toBe(false);
  });

  it('accepts worker claim payloads with a canonical build artifact image repository', (): void => {
    const result: WorkerClaimDeploymentResponse = workerClaimDeploymentResponseSchema.parse({
      deployment: {
        deploymentId: 'dep_123',
        deploymentRunId: 'drn_123',
        environmentId: 'env_123',
        environmentName: 'production',
        node: {
          id: 'node_123',
          name: 'local-node',
          nodeSocketPath: '/tmp/compartment/contracts/node/agent.sock',
        },
        previousDeployment: {
          containerId: 'container_previous',
          deploymentId: 'dep_previous',
          imageRef: 'sha256:previous',
          nodeId: 'node_previous',
          nodeSocketPath: '/tmp/compartment/contracts/node/previous-agent.sock',
          upstreamHost: '127.0.0.1',
          upstreamPort: 30999,
        },
        projectId: 'prj_123',
        projectName: 'smoke-web',
        readiness: {
          path: '/healthz',
          timeoutMs: 30000,
          type: 'http',
        },
        requiresSourceRoutesFile: false,
        run: {
          command: 'pnpm start',
          restart: {
            policy: 'on-failure',
          },
        },
        release: null,
        artifact: {
          id: 'art_123',
          imageRef: null,
          sourceDigest: 'sha256:source',
        },
        buildEnv: {},
        routeHost: 'smoke-web.localhost',
        runtimeEnv: {},
        runtimeNetwork: {
          requiresResourceNetwork: false,
        },
        service: {
          build: {
            env: [],
            include: [],
            packages: {
              build: [],
              runtime: [],
            },
            strategy: 'auto',
          },
          id: 'svc_123',
          kind: 'web',
          name: 'web',
          path: '.',
        },
      },
    });

    const deployment: WorkerClaimedDeployment = expectPresent(result.deployment, 'deployment');
    const previousDeployment: RuntimePreviousDeployment = expectPresent(
      deployment.previousDeployment,
      'previous deployment',
    );

    expect(deployment.artifact.id).toBe('art_123');
    expect(previousDeployment.nodeSocketPath).toBe('/tmp/compartment/contracts/node/previous-agent.sock');
  });

  it('accepts worker recovery queries with an explicit mode', (): void => {
    const result: WorkerRecoverDeploymentsQuery = workerRecoverDeploymentsQuerySchema.parse({
      mode: 'pending-drain',
    });

    expect(result.mode).toBe('pending-drain');
  });

  it('accepts worker recovery payloads with cleanup targets', (): void => {
    const result: WorkerRecoverDeploymentsResponse = workerRecoverDeploymentsResponseSchema.parse({
      cleanupArtifacts: [
        {
          imageRef: 'registry.example/compartment/projects/prj_123/services/svc_123@sha256:abc',
        },
      ],
      recoveredDeploymentCount: 1,
    });

    expect(expectPresent(result.cleanupArtifacts[0], 'cleanup artifact').imageRef).toContain('@sha256:abc');
  });

  it('accepts deployment inspect payloads with runtime details', (): void => {
    const result: DeploymentInspectResponse = deploymentInspectResponseSchema.parse(
      buildDeploymentInspectResponse({
        project: buildProjectSummary({ name: 'smoke-railpack' }),
      }),
    );

    expect(expectPresent(result.activeDeployments[0], 'active deployment').runtime).toEqual(
      expect.objectContaining({
        routeHost: 'smoke-railpack.localhost',
        upstreamPort: 31000,
      }),
    );
  });

  it('accepts Kubernetes inspect runtime details without a container id', (): void => {
    const activeDeployment: DeploymentInspectTarget = buildDeploymentInspectTarget({
      containerId: null,
      runtime: {
        containerId: null,
        imageRef: 'registry.example/app@sha256:abc',
        routeHost: 'smoke-railpack.localhost',
        runtimeKind: 'kubernetes',
        upstreamHost: 'app-smoke.cpt-smoke.svc',
        upstreamPort: 80,
      },
    });

    const result: DeploymentInspectResponse = deploymentInspectResponseSchema.parse(
      buildDeploymentInspectResponse({ activeDeployments: [activeDeployment] }),
    );

    expect(result.activeDeployments[0]?.runtime).toMatchObject({ containerId: null, runtimeKind: 'kubernetes' });
  });

  it('rejects deployment inspect payloads without rollback availability', (): void => {
    const activeDeployment: DeploymentInspectTarget = buildDeploymentInspectTarget({
      containerId: 'ctr_compat_123',
      drain: null,
      id: 'dep_compat_123',
      isActive: false,
      operation: {
        completedAt: '2026-03-24T10:00:00.000Z',
        createdAt: '2026-03-24T09:00:00.000Z',
        id: 'op_compat_123',
        status: 'succeeded',
        targetId: 'dep_compat_123',
        targetType: 'deployment',
        type: 'deployment.create',
      },
      reusableImageState: 'available',
      runtime: null,
    });
    const activeDeploymentWithoutRollback: Partial<DeploymentInspectTarget> = { ...activeDeployment };
    delete activeDeploymentWithoutRollback.rollbackAvailable;
    const result: SafeParseReturnType<DeploymentInspectResponse, DeploymentInspectResponse> =
      deploymentInspectResponseSchema.safeParse(
        buildDeploymentInspectResponse({
          activeDeployments: [activeDeploymentWithoutRollback as DeploymentInspectTarget],
          environment: {
            createdAt: '2026-03-24T09:00:00.000Z',
            id: 'env_compat_123',
            name: 'production',
            projectId: 'prj_compat_123',
            updatedAt: '2026-03-24T09:00:00.000Z',
          },
          project: buildProjectSummary({
            id: 'prj_compat_123',
            name: 'smoke-railpack',
            organizationId: 'org_compat_123',
          }),
        }),
      );

    expect(result.success).toBe(false);
  });

  it('accepts node inspect queries with optional readiness fields', (): void => {
    const result: NodeInspectDeploymentQuery = nodeInspectDeploymentQuerySchema.parse({
      deploymentId: 'dep_123',
      environmentName: 'production',
      projectName: 'smoke-web',
      readinessPath: '/healthz',
      readinessTimeoutMs: '30000',
      readinessType: 'http',
      serviceName: 'web',
    });

    expect(result.readinessTimeoutMs).toBe(30000);
  });

  it('rejects archived state in project show payloads', (): void => {
    const result: SafeParseReturnType<ProjectShowResponse, ProjectShowResponse> = projectShowResponseSchema.safeParse({
      descriptorFile: '/tmp/compartment.yml',
      localProjectName: 'smoke-web',
      project: {
        archivedAt: '2026-03-24T10:00:00.000Z',
        createdAt: '2026-03-24T09:00:00.000Z',
        id: 'prj_123',
        name: 'smoke-web',
        organizationId: 'org_123',
        updatedAt: '2026-03-24T10:00:00.000Z',
      },
      remoteState: 'archived',
    });

    expect(result.success).toBe(false);
  });

  it('accepts archive-state project list queries', (): void => {
    const result: ProjectListQuery = projectListQuerySchema.parse({
      archiveState: 'all',
    });

    expect(result.archiveState).toBe('all');
  });

  it('accepts status project list queries with a single projectId string', (): void => {
    const result: ProjectListQuery = projectListQuerySchema.parse({
      detail: 'status',
      projectIds: 'prj_123',
    });

    expect(result.projectIds).toEqual(['prj_123']);
  });

  it('accepts status project list queries with multiple projectIds', (): void => {
    const result: ProjectListQuery = projectListQuerySchema.parse({
      detail: 'status',
      projectIds: ['prj_123', 'prj_456'],
    });

    expect(result.projectIds).toEqual(['prj_123', 'prj_456']);
  });

  it('rejects status project list queries without projectIds', (): void => {
    const result: SafeParseReturnType<ProjectListQuery, ProjectListQuery> = projectListQuerySchema.safeParse({
      detail: 'status',
    });

    expect(result.success).toBe(false);
  });

  it('rejects projectIds when detail is not status', (): void => {
    const result: SafeParseReturnType<ProjectListQuery, ProjectListQuery> = projectListQuerySchema.safeParse({
      detail: 'overview',
      projectIds: ['prj_123'],
    });

    expect(result.success).toBe(false);
  });

  it('accepts overview project list responses with overview rows', (): void => {
    const result: ProjectListResponse = projectListResponseSchema.parse({
      detail: 'overview',
      pagination: {
        page: 1,
        perPage: 10,
        totalItems: 1,
        totalPages: 1,
      },
      projects: [buildProjectOverviewSummary()],
    });

    expect(result.detail).toBe('overview');
    expect(result.projects[0]).toEqual(
      expect.objectContaining({
        environmentName: 'production',
        status: 'healthy',
      }),
    );
  });

  it('accepts status project list responses through the discriminated list schema', (): void => {
    const result: ProjectListResponse = projectListResponseSchema.parse({
      detail: 'status',
      projects: [buildProjectStatusSummary()],
    });

    expect(result.detail).toBe('status');
    expect(result.projects[0]).toEqual(expect.objectContaining({ routeUrl: 'https://smoke.example.com' }));
  });

  it('accepts status project list responses through the direct status schema', (): void => {
    const result: ProjectStatusListResponse = projectStatusListResponseSchema.parse({
      detail: 'status',
      projects: [buildProjectStatusSummary()],
    });

    expect(result.projects).toHaveLength(1);
    expect(result.projects[0]).toEqual(expect.objectContaining({ lifecycleState: 'running' }));
  });

  it('rejects summary rows in overview project list responses', (): void => {
    const payload: ProjectOverviewListResponseWithSummaryRowsPayload = {
      detail: 'overview',
      pagination: {
        page: 1,
        perPage: 10,
        totalItems: 1,
        totalPages: 1,
      },
      projects: [
        {
          archivedAt: null,
          createdAt: '2026-03-24T09:00:00.000Z',
          id: 'prj_123',
          name: 'smoke-web',
          organizationId: 'org_123',
          updatedAt: '2026-03-24T10:00:00.000Z',
        },
      ],
    };
    const result: SafeParseReturnType<ProjectListResponse, ProjectListResponse> =
      projectListResponseSchema.safeParse(payload);

    expect(result.success).toBe(false);
  });

  it('accepts user list queries and paginated responses', (): void => {
    const query: UserListQuery = userListQuerySchema.parse({
      orderBy: 'email',
      page: '2',
      perPage: '10',
      search: 'viewer',
      sort: 'desc',
      type: 'user',
    });
    const response: UserListResponse = userListResponseSchema.parse({
      pagination: {
        page: 2,
        perPage: 10,
        totalItems: 11,
        totalPages: 2,
      },
      users: [
        {
          access: 'allowed',
          accessSummary: 'Limited view',
          directAccessScopeLabels: [],
          email: 'viewer@example.com',
          groupCount: 1,
          groupNames: ['Operators'],
          id: 'prn_456',
          roleNames: ['Project Viewer'],
          status: 'invited',
          type: 'user',
        },
      ],
    });

    expect(query.page).toBe(2);
    expect(query.type).toBe('user');
    expect(expectPresent(response.users[0], 'user').email).toBe('viewer@example.com');
  });
});
