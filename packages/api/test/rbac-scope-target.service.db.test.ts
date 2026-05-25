import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { isApiBusinessError } from '../src/errors/api-business-error';
import { resolveStoredScopeTarget } from '../src/services/rbac-scope-target.service';
import {
  clearRbacTestHarnessRuntime,
  closeRbacTestHarness,
  configureRbacTestRuntime,
  createRbacTestHarness,
  ensureRbacTestHarness,
  resetRbacTestHarness,
  seedEnvironment,
  seedOrganization,
  seedProject,
  type RbacTestHarness,
} from './rbac-test.fixtures';

const harness: RbacTestHarness = createRbacTestHarness('rbac_scope_target_service');

describe('rbac scope target service db', (): void => {
  beforeAll(async (): Promise<void> => {
    await ensureRbacTestHarness(harness);
  });

  beforeEach(async (): Promise<void> => {
    await resetRbacTestHarness(harness);
    configureRbacTestRuntime(harness);
    await seedOrganization(harness, { id: 'org_123' });
    await seedProject(harness, { id: 'prj_123', name: 'billing', organizationId: 'org_123' });
    await seedEnvironment(harness, { id: 'env_123', name: 'production', projectId: 'prj_123' });
  });

  afterEach((): void => {
    clearRbacTestHarnessRuntime();
  });

  afterAll(async (): Promise<void> => {
    await closeRbacTestHarness(harness);
  });

  it('resolves stored scope ids from organization, project, and environment targets', async (): Promise<void> => {
    await expect(resolveStoredScopeTarget('org_123', { scopeType: 'organization' })).resolves.toEqual({
      scopeId: 'org_123',
      scopeType: 'organization',
    });
    await expect(
      resolveStoredScopeTarget('org_123', { projectName: 'billing', scopeType: 'project' }),
    ).resolves.toEqual({
      scopeId: 'prj_123',
      scopeType: 'project',
    });
    await expect(
      resolveStoredScopeTarget('org_123', {
        environmentName: 'production',
        projectName: 'billing',
        scopeType: 'environment',
      }),
    ).resolves.toEqual({
      scopeId: 'env_123',
      scopeType: 'environment',
    });
  });

  it('rejects missing project or environment targets', async (): Promise<void> => {
    await expect(
      resolveStoredScopeTarget('org_123', { projectName: 'missing', scopeType: 'project' }),
    ).rejects.toSatisfy(
      (error: Error | null | undefined): boolean =>
        error instanceof Error && isApiBusinessError(error) && error.code === 'project_not_found',
    );
    await expect(
      resolveStoredScopeTarget('org_123', {
        environmentName: 'missing',
        projectName: 'billing',
        scopeType: 'environment',
      }),
    ).rejects.toSatisfy(
      (error: Error | null | undefined): boolean =>
        error instanceof Error && isApiBusinessError(error) && error.code === 'environment_not_found',
    );
  });
});
