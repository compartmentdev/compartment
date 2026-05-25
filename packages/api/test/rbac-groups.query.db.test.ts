import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { isApiBusinessError } from '../src/errors/api-business-error';
import { organizationMemberships } from '../src/db/schema';
import { listAccessAssignmentSummaries } from '../src/queries/rbac-assignments.query';
import { listAccessGroups, listPrincipalGroupCounts } from '../src/queries/rbac-groups.query';
import {
  addOrganizationAccessGroupMember,
  createOrganizationAccessGroup,
  deleteOrganizationAccessGroup,
  listOrganizationAccessGroupMembers,
  updateOrganizationAccessGroup,
} from '../src/services/access-groups.service';
import type { AccessGroupResult } from '../src/services/access-groups.service.types';
import {
  clearRbacTestHarnessRuntime,
  closeRbacTestHarness,
  configureRbacTestRuntime,
  createRbacTestHarness,
  ensureRbacTestHarness,
  resetRbacTestHarness,
  seedAssignment,
  seedCustomRole,
  seedSystemRoles,
  seedOrganization,
  seedPrincipal,
  findRoleIdByName,
  type RbacTestHarness,
} from './rbac-test.fixtures';

const harness: RbacTestHarness = createRbacTestHarness('rbac_groups_query');

describe('rbac groups db', (): void => {
  beforeAll(async (): Promise<void> => {
    await ensureRbacTestHarness(harness);
  });

  beforeEach(async (): Promise<void> => {
    await resetRbacTestHarness(harness);
    configureRbacTestRuntime(harness);
    await seedOrganization(harness, { id: 'org_123' });
    await seedPrincipal(harness, {
      email: 'active@example.com',
      id: 'prn_active',
      passwordHash: 'hashed',
    });
    await seedPrincipal(harness, {
      email: 'invited@example.com',
      id: 'prn_invited',
      passwordHash: null,
    });
    await harness.db.insert(organizationMemberships).values([
      {
        id: 'mem_active',
        organizationId: 'org_123',
        principalId: 'prn_active',
      },
      {
        id: 'mem_invited',
        organizationId: 'org_123',
        principalId: 'prn_invited',
      },
    ]);
    await seedSystemRoles(harness, 'org_123');
    await seedAssignment(harness, {
      id: 'asg_active_admin',
      organizationId: 'org_123',
      roleId: await findRoleIdByName(harness, 'org_123', 'admin'),
      scopeId: 'org_123',
      scopeType: 'organization',
      subjectId: 'prn_active',
      subjectType: 'principal',
    });
  });

  afterEach((): void => {
    clearRbacTestHarnessRuntime();
  });

  afterAll(async (): Promise<void> => {
    await closeRbacTestHarness(harness);
  });

  it('creates, renames, lists, and deletes groups', async (): Promise<void> => {
    const group: AccessGroupResult = await createOrganizationAccessGroup('org_123', { name: 'Operators' });

    await updateOrganizationAccessGroup('org_123', group.id, { name: 'Deploy Operators' });

    expect(await listAccessGroups('org_123')).toMatchObject([
      {
        assignmentCount: 0,
        memberCount: 0,
        name: 'Deploy Operators',
      },
    ]);

    await deleteOrganizationAccessGroup('org_123', group.id);

    expect(await listAccessGroups('org_123')).toEqual([]);
  });

  it('rejects duplicate group names within an organization', async (): Promise<void> => {
    await createOrganizationAccessGroup('org_123', { name: 'Operators' });

    await expect(createOrganizationAccessGroup('org_123', { name: 'Operators' })).rejects.toSatisfy(
      (error: Error | null | undefined): boolean =>
        error instanceof Error && isApiBusinessError(error) && error.code === 'access_group_name_taken',
    );
  });

  it('adds members idempotently and reports active versus invited states', async (): Promise<void> => {
    const group: AccessGroupResult = await createOrganizationAccessGroup('org_123', { name: 'Operators' });

    await addOrganizationAccessGroupMember({
      actorPrincipalId: 'prn_active',
      groupId: group.id,
      organizationId: 'org_123',
      request: { email: 'active@example.com' },
    });
    await addOrganizationAccessGroupMember({
      actorPrincipalId: 'prn_active',
      groupId: group.id,
      organizationId: 'org_123',
      request: { email: 'active@example.com' },
    });
    await addOrganizationAccessGroupMember({
      actorPrincipalId: 'prn_active',
      groupId: group.id,
      organizationId: 'org_123',
      request: { email: 'invited@example.com' },
    });

    expect(await listOrganizationAccessGroupMembers('org_123', group.id)).toEqual([
      {
        email: 'active@example.com',
        id: 'prn_active',
        status: 'active',
      },
      {
        email: 'invited@example.com',
        id: 'prn_invited',
        status: 'invited',
      },
    ]);
    expect(await listAccessGroups('org_123')).toMatchObject([
      {
        assignmentCount: 0,
        memberCount: 2,
        name: 'Operators',
      },
    ]);
  });

  it('counts group memberships for multiple principals in one query surface', async (): Promise<void> => {
    const operators: AccessGroupResult = await createOrganizationAccessGroup('org_123', { name: 'Operators' });
    const reviewers: AccessGroupResult = await createOrganizationAccessGroup('org_123', { name: 'Reviewers' });

    await addOrganizationAccessGroupMember({
      actorPrincipalId: 'prn_active',
      groupId: operators.id,
      organizationId: 'org_123',
      request: { email: 'active@example.com' },
    });
    await addOrganizationAccessGroupMember({
      actorPrincipalId: 'prn_active',
      groupId: reviewers.id,
      organizationId: 'org_123',
      request: { email: 'active@example.com' },
    });
    await addOrganizationAccessGroupMember({
      actorPrincipalId: 'prn_active',
      groupId: reviewers.id,
      organizationId: 'org_123',
      request: { email: 'invited@example.com' },
    });

    expect(await listPrincipalGroupCounts('org_123', ['prn_active', 'prn_invited'])).toEqual([
      { groupCount: 2, principalId: 'prn_active' },
      { groupCount: 1, principalId: 'prn_invited' },
    ]);
  });

  it('deletes group assignments together with the group so follow-up reads stay healthy', async (): Promise<void> => {
    const group: AccessGroupResult = await createOrganizationAccessGroup('org_123', { name: 'Operators' });
    await addOrganizationAccessGroupMember({
      actorPrincipalId: 'prn_active',
      groupId: group.id,
      organizationId: 'org_123',
      request: { email: 'active@example.com' },
    });
    await seedCustomRole(harness, {
      id: 'rol_operator',
      name: 'Operator',
      organizationId: 'org_123',
      permissionKeys: ['deployment.create'],
    });
    await seedAssignment(harness, {
      id: 'asg_operator',
      organizationId: 'org_123',
      roleId: 'rol_operator',
      scopeId: 'org_123',
      scopeType: 'organization',
      subjectId: group.id,
      subjectType: 'group',
    });

    expect(await listAccessAssignmentSummaries('org_123')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          groupId: group.id,
          groupName: 'Operators',
          roleName: 'Operator',
        }),
      ]),
    );

    await deleteOrganizationAccessGroup('org_123', group.id);

    expect(await listAccessGroups('org_123')).toEqual([]);
    expect(await listAccessAssignmentSummaries('org_123')).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          groupId: group.id,
        }),
      ]),
    );
  });
});
