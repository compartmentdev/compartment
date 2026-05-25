import type { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { listProjectsByOrganization } from '../src/queries/projects.query';
import type { ProjectRow } from '../src/queries/projects.query.types';
import { listVisibleProjectSummaries, type VisibleProjectSummary } from '../src/services/project-visibility.service';
import {
  clearRbacTestHarnessRuntime,
  closeRbacTestHarness,
  configureRbacTestRuntime,
  createRbacTestHarness,
  ensureRbacTestHarness,
  resetRbacTestHarness,
  seedAssignment,
  seedCustomRole,
  seedEnvironment,
  seedOrganization,
  seedOrganizationMembership,
  seedPrincipal,
  seedProject,
  type RbacTestHarness,
} from './rbac-test.fixtures';

const harness: RbacTestHarness = createRbacTestHarness('project_visibility_service');

describe('project visibility service db', (): void => {
  beforeAll(async (): Promise<void> => {
    await ensureRbacTestHarness(harness);
  });

  beforeEach(async (): Promise<void> => {
    await resetRbacTestHarness(harness);
    configureRbacTestRuntime(harness);
    await seedOrganization(harness, { id: 'org_123' });
    await seedProject(harness, { id: 'prj_123', name: 'billing', organizationId: 'org_123' });
    await seedProject(harness, { id: 'prj_456', name: 'ops', organizationId: 'org_123' });
    await seedEnvironment(harness, { id: 'env_123', name: 'production', projectId: 'prj_123' });
    await seedPrincipal(harness, { email: 'viewer@example.com', id: 'prn_viewer', passwordHash: 'hashed' });
    await seedOrganizationMembership(harness, {
      id: 'mem_viewer',
      organizationId: 'org_123',
      principalId: 'prn_viewer',
    });
    await seedCustomRole(harness, {
      id: 'rol_project_viewer',
      name: 'Project Viewer',
      organizationId: 'org_123',
      permissionKeys: ['project.read'],
    });
    await seedCustomRole(harness, {
      id: 'rol_env_logs',
      name: 'Environment Logs',
      organizationId: 'org_123',
      permissionKeys: ['deployment.logs.read'],
    });
  });

  afterEach((): void => {
    clearRbacTestHarnessRuntime();
  });

  afterAll(async (): Promise<void> => {
    await closeRbacTestHarness(harness);
  });

  it('makes projects visible from project.read assignments', async (): Promise<void> => {
    await seedAssignment(harness, {
      id: 'asg_project',
      organizationId: 'org_123',
      roleId: 'rol_project_viewer',
      scopeId: 'prj_123',
      scopeType: 'project',
      subjectId: 'prn_viewer',
      subjectType: 'principal',
    });

    const summaries: VisibleProjectSummary[] = await listVisibleProjectSummaries(
      'org_123',
      'prn_viewer',
      await listProjectsByOrganization('org_123', true),
    );

    expect(summaries.map((summary: VisibleProjectSummary): string => summary.project.name)).toEqual(['billing']);
  });

  it('makes a project visible from an environment-only assignment without project-wide permissions', async (): Promise<void> => {
    await seedAssignment(harness, {
      id: 'asg_env',
      organizationId: 'org_123',
      roleId: 'rol_env_logs',
      scopeId: 'env_123',
      scopeType: 'environment',
      subjectId: 'prn_viewer',
      subjectType: 'principal',
    });

    const [billing] = await listVisibleProjectSummaries(
      'org_123',
      'prn_viewer',
      await listProjectsByOrganization('org_123', true),
    );

    expect(billing).toMatchObject({
      hasEnvironmentVisibility: true,
      permissions: [],
      project: {
        name: 'billing',
      },
    });
  });

  it('keeps nearest-scope precedence while batching project visibility across multiple projects', async (): Promise<void> => {
    await seedProject(harness, { id: 'prj_789', name: 'reports', organizationId: 'org_123' });
    await seedAssignment(harness, {
      id: 'asg_org_read',
      organizationId: 'org_123',
      roleId: 'rol_project_viewer',
      scopeId: 'org_123',
      scopeType: 'organization',
      subjectId: 'prn_viewer',
      subjectType: 'principal',
    });
    await seedAssignment(harness, {
      id: 'asg_billing_project_logs',
      organizationId: 'org_123',
      roleId: 'rol_env_logs',
      scopeId: 'prj_123',
      scopeType: 'project',
      subjectId: 'prn_viewer',
      subjectType: 'principal',
    });
    await seedAssignment(harness, {
      id: 'asg_billing_env_logs',
      organizationId: 'org_123',
      roleId: 'rol_env_logs',
      scopeId: 'env_123',
      scopeType: 'environment',
      subjectId: 'prn_viewer',
      subjectType: 'principal',
    });
    await seedAssignment(harness, {
      id: 'asg_ops_project_logs',
      organizationId: 'org_123',
      roleId: 'rol_env_logs',
      scopeId: 'prj_456',
      scopeType: 'project',
      subjectId: 'prn_viewer',
      subjectType: 'principal',
    });

    const projects: ProjectRow[] = await listProjectsByOrganization('org_123', true);
    const singleProjectQueryCount: number = await countPoolQueries(harness.pool, async (): Promise<void> => {
      await listVisibleProjectSummaries('org_123', 'prn_viewer', [projects[0]!]);
    });
    const multiProjectRun: { queryCount: number; result: VisibleProjectSummary[] } = await capturePoolQueryCount(
      harness.pool,
      async (): Promise<VisibleProjectSummary[]> =>
        await listVisibleProjectSummaries('org_123', 'prn_viewer', projects),
    );
    const summaries: VisibleProjectSummary[] = multiProjectRun.result;
    const multiProjectQueryCount: number = multiProjectRun.queryCount;

    expect(summaries).toMatchObject([
      {
        hasEnvironmentVisibility: true,
        permissions: ['deployment.logs.read'],
        project: { name: 'billing' },
      },
      {
        hasEnvironmentVisibility: false,
        permissions: ['project.read'],
        project: { name: 'reports' },
      },
    ]);
    expect(multiProjectQueryCount).toBe(singleProjectQueryCount);
  });
});

async function countPoolQueries(pool: Pool, action: () => Promise<void>): Promise<number> {
  return (await capturePoolQueryCount(pool, action)).queryCount;
}

async function capturePoolQueryCount<T>(
  dbPool: Pool,
  action: () => Promise<T>,
): Promise<{ queryCount: number; result: T }> {
  const querySpy: MockInstance = vi.spyOn(dbPool, 'query');
  try {
    const result: T = await action();
    return {
      queryCount: querySpy.mock.calls.length,
      result,
    };
  } finally {
    querySpy.mockRestore();
  }
}
