import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import {
  inviteUserResponseSchema,
  type InviteUserResponse,
  type OrganizationUserResponse,
  type RemoveUserResponse,
  type UserListResponse,
} from '@compartment/contracts';
import type { AuthenticatedContext } from '../src/services/context.types';
import type { CliConfig } from '../src/store/config.types';
import { createCliConfigFixture } from './cli-test.fixtures';
import {
  type CliCommandCapture,
  type CliCommandResult,
  type CliJsonResult,
  createCliCapture,
  expectCliFailure,
  expectCliSuccess,
  readCliStdout,
  resetCliCommandModules,
  restoreCliCommandModules,
  runCliCommand,
  runCliJson,
} from './cli-test.harness';

interface OrganizationUserCommandMocks {
  inviteOrganizationUserMock: Mock<InviteOrganizationUser>;
  listOrganizationUsersMock: Mock<ListOrganizationUsers>;
  readCliConfigMock: Mock<ReadCliConfig>;
  removeOrganizationUserMock: Mock<RemoveOrganizationUser>;
}

interface OrganizationUsersServiceModule {
  blockOrganizationUser: Mock<BlockOrganizationUser>;
  inviteOrganizationUser: Mock<InviteOrganizationUser>;
  listOrganizationUsers: Mock<ListOrganizationUsers>;
  removeOrganizationUser: Mock<RemoveOrganizationUser>;
  unblockOrganizationUser: Mock<UnblockOrganizationUser>;
}

interface ConfigStoreModule {
  readCliConfig: Mock<ReadCliConfig>;
}

type BlockOrganizationUser = (context: AuthenticatedContext, email: string) => Promise<OrganizationUserResponse>;
type InviteOrganizationUser = (context: AuthenticatedContext, input: { email: string }) => Promise<InviteUserResponse>;
interface ListOrganizationUsersInput {
  page: number;
  perPage: number;
}

type ListOrganizationUsers = (
  context: AuthenticatedContext,
  input: ListOrganizationUsersInput,
) => Promise<UserListResponse>;
type ReadCliConfig = () => Promise<CliConfig>;
type RemoveOrganizationUser = (context: AuthenticatedContext, email: string) => Promise<RemoveUserResponse>;
type UnblockOrganizationUser = (context: AuthenticatedContext, email: string) => Promise<OrganizationUserResponse>;

const commandTestTimeoutMs: number = 10000;

describe.sequential('compartment user and role commands', (): void => {
  beforeEach((): void => {
    resetCliCommandModules();
  });

  afterEach((): void => {
    restoreCliCommandModules(['../src/services/organization-users.service', '../src/store/config.store']);
  });

  it(
    'renders organization user list output with a next-page hint',
    async (): Promise<void> => {
      const mocks: OrganizationUserCommandMocks = mockOrganizationUserCommandModules();
      mocks.listOrganizationUsersMock.mockResolvedValue(createUserListResponse());
      const result: CliCommandResult = await runCliCommand(['user', 'list'], createCliCapture());

      expectCliSuccess(result);
      expect(readCliStdout(result.capture))
        .toBe(`admin@example.com\tuser\tfull access\tno-groups\tno-direct-access\tactive\tallowed
viewer@example.com\tuser\tmembership only\tno-groups\tno-direct-access\tinvited\tallowed
Showing users 1-2 of 4. Use --page 2 to view more.
`);
    },
    commandTestTimeoutMs,
  );

  it('emits the invite JSON contract', async (): Promise<void> => {
    const mocks: OrganizationUserCommandMocks = mockOrganizationUserCommandModules();
    mocks.inviteOrganizationUserMock.mockResolvedValue(createInviteUserResponse());
    const result: CliJsonResult<InviteUserResponse> = await runCliJson(
      ['user', 'invite', 'viewer@example.com', '--output', 'json'],
      inviteUserResponseSchema,
    );

    expectCliSuccess(result);
    expect(result.payload).toEqual(createInviteUserResponse());
  });

  it('removes a user and renders the success message', async (): Promise<void> => {
    const mocks: OrganizationUserCommandMocks = mockOrganizationUserCommandModules();
    mocks.removeOrganizationUserMock.mockResolvedValue(createRemoveUserResponse());
    const capture: CliCommandCapture = createCliCapture();
    const result: CliCommandResult = await runCliCommand(['user', 'remove', 'viewer@example.com', '--yes'], capture);

    expectCliSuccess(result);
    expect(readCliStdout(capture)).toContain('Removed viewer@example.com from the current organization.');
  });

  it('requires explicit destructive confirmation for user remove', async (): Promise<void> => {
    const mocks: OrganizationUserCommandMocks = mockOrganizationUserCommandModules();
    const result: CliCommandResult = await runCliCommand(['user', 'remove', 'viewer@example.com'], createCliCapture());

    expectCliFailure(result, 'User remove requires --yes.');
    expect(mocks.removeOrganizationUserMock).not.toHaveBeenCalled();
  });
});

function createInviteUserResponse(): InviteUserResponse {
  return {
    invitation: {
      activationUrl: 'https://console.example/activate?email=viewer%40example.com&token=invite-token',
      bootstrapExpiresAt: '2099-03-31T00:00:00.000Z',
      bootstrapToken: 'invite-token',
    },
    user: {
      access: 'allowed',
      email: 'viewer@example.com',
      groupCount: 0,
      id: 'usr_456',
      roleNames: [],
      status: 'invited',
      type: 'user',
    },
  };
}

function createUserListResponse(): UserListResponse {
  return {
    pagination: {
      page: 1,
      perPage: 2,
      totalItems: 4,
      totalPages: 2,
    },
    users: [
      {
        access: 'allowed',
        accessSummary: 'Full access',
        directAccessScopeLabels: [],
        email: 'admin@example.com',
        groupCount: 0,
        groupNames: [],
        id: 'usr_123',
        roleNames: ['admin'],
        status: 'active',
        type: 'user',
      },
      {
        access: 'allowed',
        accessSummary: 'Membership only',
        directAccessScopeLabels: [],
        email: 'viewer@example.com',
        groupCount: 0,
        groupNames: [],
        id: 'usr_456',
        roleNames: [],
        status: 'invited',
        type: 'user',
      },
    ],
  };
}

function createRemoveUserResponse(): RemoveUserResponse {
  return {
    success: true,
  };
}

function mockOrganizationUserCommandModules(): OrganizationUserCommandMocks {
  const readCliConfigMock: Mock<ReadCliConfig> = vi.fn<ReadCliConfig>().mockResolvedValue(
    createCliConfigFixture({
      principalEmail: undefined,
    }),
  );
  const blockOrganizationUserMock: Mock<BlockOrganizationUser> = vi.fn<BlockOrganizationUser>();
  const inviteOrganizationUserMock: Mock<InviteOrganizationUser> = vi.fn<InviteOrganizationUser>();
  const listOrganizationUsersMock: Mock<ListOrganizationUsers> = vi.fn<ListOrganizationUsers>();
  const removeOrganizationUserMock: Mock<RemoveOrganizationUser> = vi.fn<RemoveOrganizationUser>();
  const unblockOrganizationUserMock: Mock<UnblockOrganizationUser> = vi.fn<UnblockOrganizationUser>();

  vi.doMock(
    '../src/services/organization-users.service',
    (): OrganizationUsersServiceModule => ({
      blockOrganizationUser: blockOrganizationUserMock,
      inviteOrganizationUser: inviteOrganizationUserMock,
      listOrganizationUsers: listOrganizationUsersMock,
      removeOrganizationUser: removeOrganizationUserMock,
      unblockOrganizationUser: unblockOrganizationUserMock,
    }),
  );
  vi.doMock(
    '../src/store/config.store',
    (): ConfigStoreModule => ({
      readCliConfig: readCliConfigMock,
    }),
  );

  return {
    inviteOrganizationUserMock,
    listOrganizationUsersMock,
    readCliConfigMock,
    removeOrganizationUserMock,
  };
}
