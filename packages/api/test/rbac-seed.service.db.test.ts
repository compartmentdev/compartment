import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { RbacTransaction } from '../src/queries/rbac.query.types';
import { listAccessRoles } from '../src/queries/rbac-roles.query';
import {
  listDirectAccessAssignmentSummariesForPrincipal,
  listDirectPrincipalPermissionGrantRows,
} from '../src/queries/rbac-assignments.query';
import { assignOrganizationSystemRoleToPrincipalWithExecutor } from '../src/services/rbac-seed.service';
import {
  clearRbacTestHarnessRuntime,
  closeRbacTestHarness,
  configureRbacTestRuntime,
  createRbacTestHarness,
  ensureRbacTestHarness,
  seedOrganizationMembership,
  seedOrganization,
  seedPrincipal,
  resetRbacTestHarness,
  type RbacTestHarness,
} from './rbac-test.fixtures';

const harness: RbacTestHarness = createRbacTestHarness('rbac_seed_service');

describe('rbac seed service db', (): void => {
  beforeAll(async (): Promise<void> => {
    await ensureRbacTestHarness(harness);
  });

  beforeEach(async (): Promise<void> => {
    await resetRbacTestHarness(harness);
    configureRbacTestRuntime(harness);
    await seedOrganization(harness, { id: 'org_123' });
  });

  afterEach((): void => {
    clearRbacTestHarnessRuntime();
  });

  afterAll(async (): Promise<void> => {
    await closeRbacTestHarness(harness);
  });

  it('seeds the four system roles idempotently', async (): Promise<void> => {
    await seedPrincipal(harness, {
      email: 'viewer@example.com',
      id: 'prn_viewer',
      passwordHash: 'hashed',
    });
    await seedOrganizationMembership(harness, {
      id: 'mem_viewer',
      organizationId: 'org_123',
      principalId: 'prn_viewer',
    });

    await harness.db.transaction(async (tx: RbacTransaction): Promise<void> => {
      await assignOrganizationSystemRoleToPrincipalWithExecutor(tx, 'org_123', 'prn_viewer', 'viewer');
      await assignOrganizationSystemRoleToPrincipalWithExecutor(tx, 'org_123', 'prn_viewer', 'viewer');
    });

    expect((await listAccessRoles('org_123')).map((role: { name: string }): string => role.name)).toEqual([
      'admin',
      'deployer',
      'readonly',
      'viewer',
    ]);
  });

  it('creates the expected org-scoped admin assignment for a creator', async (): Promise<void> => {
    await seedPrincipal(harness, {
      email: 'admin@example.com',
      id: 'prn_admin',
      passwordHash: 'hashed',
    });
    await seedOrganizationMembership(harness, {
      id: 'mem_admin',
      organizationId: 'org_123',
      principalId: 'prn_admin',
    });

    await harness.db.transaction(async (tx: RbacTransaction): Promise<void> => {
      await assignOrganizationSystemRoleToPrincipalWithExecutor(tx, 'org_123', 'prn_admin', 'admin');
    });

    expect(await listDirectAccessAssignmentSummariesForPrincipal('org_123', 'prn_admin')).toMatchObject([
      {
        roleKind: 'system',
        roleName: 'admin',
        scopeId: 'org_123',
        scopeType: 'organization',
        subjectType: 'principal',
      },
    ]);
    expect(
      (await listDirectPrincipalPermissionGrantRows('org_123', 'prn_admin')).map(
        (grant: { permissionKey: string }): string => grant.permissionKey,
      ),
    ).toEqual(
      expect.arrayContaining([
        'organization.user.invite',
        'organization.user.block',
        'organization.user.remove',
        'organization.user.credentials.reset',
      ]),
    );
  });
});
