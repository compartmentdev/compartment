import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import {
  accessAssignmentResponseSchema,
  accessGroupListResponseSchema,
  accessRoleResponseSchema,
  type AccessAssignmentListResponse,
  type AccessAssignmentResponse,
  type AccessGroupListResponse,
  type AccessGroupMemberListResponse,
  type AccessGroupResponse,
  type AccessRoleListResponse,
  type AccessRoleResponse,
} from '@compartment/contracts';
import type { AuthenticatedContext } from '../src/services/context.types';
import type { CliConfig } from '../src/store/config.types';
import { createCliConfigFixture } from './cli-test.fixtures';
import {
  type CliCommandResult,
  type CliJsonResult,
  expectCliFailure,
  expectCliSuccess,
  readCliStdout,
  resetCliCommandModules,
  restoreCliCommandModules,
  runCliCommand,
  runCliJson,
} from './cli-test.harness';

interface RbacCommandMocks {
  createOrganizationAccessAssignment: Mock<CreateOrganizationAccessAssignment>;
  createOrganizationAccessGroup: Mock<CreateOrganizationAccessGroup>;
  deleteOrganizationAccessGroup: Mock<DeleteOrganizationAccessGroup>;
  deleteOrganizationAccessRole: Mock<DeleteOrganizationAccessRole>;
  listOrganizationAccessAssignments: Mock<ListOrganizationAccessAssignments>;
  listOrganizationAccessGroupMembers: Mock<ListOrganizationAccessGroupMembers>;
  listOrganizationAccessGroups: Mock<ListOrganizationAccessGroups>;
  listOrganizationAccessRoles: Mock<ListOrganizationAccessRoles>;
  readCliConfig: Mock<ReadCliConfig>;
  showOrganizationAccessRole: Mock<ShowOrganizationAccessRole>;
}

interface RbacServiceModule {
  createOrganizationAccessAssignment: Mock<CreateOrganizationAccessAssignment>;
  createOrganizationAccessGroup: Mock<CreateOrganizationAccessGroup>;
  deleteOrganizationAccessGroup: Mock<DeleteOrganizationAccessGroup>;
  deleteOrganizationAccessRole: Mock<DeleteOrganizationAccessRole>;
  listOrganizationAccessAssignments: Mock<ListOrganizationAccessAssignments>;
  listOrganizationAccessGroupMembers: Mock<ListOrganizationAccessGroupMembers>;
  listOrganizationAccessGroups: Mock<ListOrganizationAccessGroups>;
  listOrganizationAccessRoles: Mock<ListOrganizationAccessRoles>;
  showOrganizationAccessRole: Mock<ShowOrganizationAccessRole>;
}

interface ConfigStoreModule {
  readCliConfig: Mock<ReadCliConfig>;
}

type CreateOrganizationAccessAssignment = (
  context: AuthenticatedContext,
  input: { roleId: string; scope: object; subject: object },
) => Promise<AccessAssignmentResponse>;
type CreateOrganizationAccessGroup = (
  context: AuthenticatedContext,
  input: { name: string },
) => Promise<AccessGroupResponse>;
type DeleteOrganizationAccessGroup = (context: AuthenticatedContext, groupId: string) => Promise<AccessGroupResponse>;
type DeleteOrganizationAccessRole = (context: AuthenticatedContext, roleId: string) => Promise<AccessRoleResponse>;
type ListOrganizationAccessAssignments = (context: AuthenticatedContext) => Promise<AccessAssignmentListResponse>;
type ListOrganizationAccessGroupMembers = (
  context: AuthenticatedContext,
  groupId: string,
) => Promise<AccessGroupMemberListResponse>;
type ListOrganizationAccessGroups = (context: AuthenticatedContext) => Promise<AccessGroupListResponse>;
type ListOrganizationAccessRoles = (context: AuthenticatedContext) => Promise<AccessRoleListResponse>;
type ReadCliConfig = () => Promise<CliConfig>;
type ShowOrganizationAccessRole = (context: AuthenticatedContext, roleId: string) => Promise<AccessRoleResponse>;

describe.sequential('rbac cli commands', (): void => {
  beforeEach((): void => {
    resetCliCommandModules();
  });

  afterEach((): void => {
    restoreCliCommandModules(['../src/services/rbac.service', '../src/store/config.store']);
  });

  it('renders the role list in text output', async (): Promise<void> => {
    const mocks: RbacCommandMocks = mockRbacCommandModules();
    mocks.listOrganizationAccessRoles.mockResolvedValue({
      roles: [
        {
          assignmentCount: 0,
          description: null,
          groupCount: 0,
          id: 'rol_123',
          kind: 'custom',
          name: 'Project Operator',
          permissionKeys: ['deployment.create', 'variable.write'],
          principalCount: 0,
        },
      ],
    });

    const result: CliCommandResult = await runCliCommand(['role', 'list']);

    expectCliSuccess(result);
    expect(readCliStdout(result.capture).trim()).toBe(
      'rol_123\tProject Operator\tcustom\tcustom\t0 assignments\tno-description',
    );
  });

  it('emits role show JSON contracts', async (): Promise<void> => {
    const mocks: RbacCommandMocks = mockRbacCommandModules();
    mocks.showOrganizationAccessRole.mockResolvedValue({
      role: {
        description: null,
        id: 'rol_123',
        kind: 'custom',
        name: 'Project Operator',
        permissionKeys: ['deployment.create'],
      },
    });

    const result: CliJsonResult<AccessRoleResponse> = await runCliJson(
      ['role', 'show', 'rol_123', '--output', 'json'],
      accessRoleResponseSchema,
    );

    expectCliSuccess(result);
    expect(result.payload.role.name).toBe('Project Operator');
  });

  it('renders group list and member list output', async (): Promise<void> => {
    const mocks: RbacCommandMocks = mockRbacCommandModules();
    mocks.listOrganizationAccessGroups.mockResolvedValue({
      groups: [
        {
          assignedRoleNames: ['Project Operator'],
          assignmentCount: 1,
          assignmentScopeLabels: ['billing'],
          description: null,
          id: 'grp_123',
          memberCount: 2,
          name: 'Operators',
        },
      ],
    });
    mocks.listOrganizationAccessGroupMembers.mockResolvedValue({
      members: [{ email: 'viewer@example.com', id: 'prn_123', status: 'active' }],
    });

    const groupList: CliJsonResult<AccessGroupListResponse> = await runCliJson(
      ['group', 'list', '--output', 'json'],
      accessGroupListResponseSchema,
    );
    const memberList: CliCommandResult = await runCliCommand(['group', 'member', 'list', 'grp_123']);

    expectCliSuccess(groupList);
    expectCliSuccess(memberList);
    expect(groupList.payload.groups[0]?.name).toBe('Operators');
    expect(readCliStdout(memberList.capture).trim()).toBe('prn_123\tviewer@example.com\tactive');
  });

  it('renders assignment list output and emits assignment create JSON', async (): Promise<void> => {
    const mocks: RbacCommandMocks = mockRbacCommandModules();
    mocks.listOrganizationAccessAssignments.mockResolvedValue({
      assignments: [
        {
          createdAt: '2026-05-05T10:00:00.000Z',
          id: 'asg_123',
          roleId: 'rol_123',
          roleKind: 'custom',
          roleName: 'Project Operator',
          scope: { projectName: 'billing', scopeType: 'project' },
          subject: { principalEmail: 'viewer@example.com', subjectType: 'principal' },
        },
      ],
    });
    mocks.createOrganizationAccessAssignment.mockResolvedValue({
      assignment: {
        createdAt: '2026-05-05T10:00:00.000Z',
        id: 'asg_123',
        roleId: 'rol_123',
        roleKind: 'custom',
        roleName: 'Project Operator',
        scope: { projectName: 'billing', scopeType: 'project' },
        subject: { principalEmail: 'viewer@example.com', subjectType: 'principal' },
      },
    });

    const listResult: CliCommandResult = await runCliCommand(['assignment', 'list']);
    const createResult: CliJsonResult<AccessAssignmentResponse> = await runCliJson(
      [
        'assignment',
        'create',
        '--role',
        'rol_123',
        '--scope',
        'project',
        '--project',
        'billing',
        '--user',
        'viewer@example.com',
        '--output',
        'json',
      ],
      accessAssignmentResponseSchema,
    );

    expectCliSuccess(listResult);
    expectCliSuccess(createResult);
    expect(readCliStdout(listResult.capture).trim()).toBe(
      'asg_123\tProject Operator\tproject:billing\tuser:viewer@example.com',
    );
    expect(createResult.payload.assignment.id).toBe('asg_123');
  });

  it('surfaces assignment subject validation and service errors to the user', async (): Promise<void> => {
    const mocks: RbacCommandMocks = mockRbacCommandModules();
    mocks.createOrganizationAccessGroup.mockRejectedValue(new Error('RBAC create failed.'));

    const invalidAssignment: CliCommandResult = await runCliCommand([
      'assignment',
      'create',
      '--role',
      'rol_123',
      '--scope',
      'organization',
    ]);
    const groupCreateFailure: CliCommandResult = await runCliCommand(['group', 'create', 'Operators']);

    expectCliFailure(invalidAssignment, 'Specify either --group or --user.');
    expectCliFailure(groupCreateFailure, 'RBAC create failed.');
  });

  it('requires explicit destructive confirmation for role delete', async (): Promise<void> => {
    const mocks: RbacCommandMocks = mockRbacCommandModules();
    const result: CliCommandResult = await runCliCommand(['role', 'delete', 'rol_123']);

    expectCliFailure(result, 'Role delete requires --yes.');
    expect(mocks.deleteOrganizationAccessRole).not.toHaveBeenCalled();
  });

  it('requires explicit destructive confirmation for group delete', async (): Promise<void> => {
    const mocks: RbacCommandMocks = mockRbacCommandModules();
    const result: CliCommandResult = await runCliCommand(['group', 'delete', 'grp_123']);

    expectCliFailure(result, 'Group delete requires --yes.');
    expect(mocks.deleteOrganizationAccessGroup).not.toHaveBeenCalled();
  });

  it('deletes roles and groups when explicit confirmation is provided', async (): Promise<void> => {
    const mocks: RbacCommandMocks = mockRbacCommandModules();
    mocks.deleteOrganizationAccessRole.mockResolvedValue({
      role: {
        description: null,
        id: 'rol_123',
        kind: 'custom',
        name: 'Project Operator',
        permissionKeys: ['project.read'],
      },
    });
    mocks.deleteOrganizationAccessGroup.mockResolvedValue({
      group: {
        assignmentCount: 0,
        description: null,
        id: 'grp_123',
        memberCount: 0,
        name: 'Operators',
      },
    });

    const deleteRoleResult: CliCommandResult = await runCliCommand(['role', 'delete', 'rol_123', '--yes']);
    const deleteGroupResult: CliCommandResult = await runCliCommand(['group', 'delete', 'grp_123', '--yes']);

    expectCliSuccess(deleteRoleResult);
    expectCliSuccess(deleteGroupResult);
    expect(readCliStdout(deleteRoleResult.capture)).toContain('Deleted role Project Operator.');
    expect(readCliStdout(deleteGroupResult.capture)).toContain('Deleted group Operators.');
  });
});

function mockRbacCommandModules(): RbacCommandMocks {
  const readCliConfig: Mock<ReadCliConfig> = vi.fn<ReadCliConfig>().mockResolvedValue(
    createCliConfigFixture({
      principalEmail: undefined,
    }),
  );
  const createOrganizationAccessAssignment: Mock<CreateOrganizationAccessAssignment> =
    vi.fn<CreateOrganizationAccessAssignment>();
  const createOrganizationAccessGroup: Mock<CreateOrganizationAccessGroup> = vi.fn<CreateOrganizationAccessGroup>();
  const deleteOrganizationAccessGroup: Mock<DeleteOrganizationAccessGroup> = vi.fn<DeleteOrganizationAccessGroup>();
  const deleteOrganizationAccessRole: Mock<DeleteOrganizationAccessRole> = vi.fn<DeleteOrganizationAccessRole>();
  const listOrganizationAccessAssignments: Mock<ListOrganizationAccessAssignments> =
    vi.fn<ListOrganizationAccessAssignments>();
  const listOrganizationAccessGroupMembers: Mock<ListOrganizationAccessGroupMembers> =
    vi.fn<ListOrganizationAccessGroupMembers>();
  const listOrganizationAccessGroups: Mock<ListOrganizationAccessGroups> = vi.fn<ListOrganizationAccessGroups>();
  const listOrganizationAccessRoles: Mock<ListOrganizationAccessRoles> = vi.fn<ListOrganizationAccessRoles>();
  const showOrganizationAccessRole: Mock<ShowOrganizationAccessRole> = vi.fn<ShowOrganizationAccessRole>();

  vi.doMock(
    '../src/services/rbac.service',
    (): RbacServiceModule => ({
      createOrganizationAccessAssignment,
      createOrganizationAccessGroup,
      deleteOrganizationAccessGroup,
      deleteOrganizationAccessRole,
      listOrganizationAccessAssignments,
      listOrganizationAccessGroupMembers,
      listOrganizationAccessGroups,
      listOrganizationAccessRoles,
      showOrganizationAccessRole,
    }),
  );
  vi.doMock(
    '../src/store/config.store',
    (): ConfigStoreModule => ({
      readCliConfig,
    }),
  );

  return {
    createOrganizationAccessAssignment,
    createOrganizationAccessGroup,
    deleteOrganizationAccessGroup,
    deleteOrganizationAccessRole,
    listOrganizationAccessAssignments,
    listOrganizationAccessGroupMembers,
    listOrganizationAccessGroups,
    listOrganizationAccessRoles,
    readCliConfig,
    showOrganizationAccessRole,
  };
}
