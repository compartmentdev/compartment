import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { ClaimAccountRequest, ClaimAccountResponse } from '@compartment/contracts';
import type { CliIo } from '../src/app.types';
import type { AuthenticatedContext } from '../src/services/context.types';
import type { CliConfig } from '../src/store/config.types';
import { createCliConfigFixture, createCliOrganizationFixture } from './cli-test.fixtures';
import {
  type CliCommandCapture,
  type CliCommandResult,
  createCliCapture,
  expectCliFailure,
  expectCliSuccess,
  readCliStdout,
  resetCliCommandModules,
  restoreCliCommandModules,
  runCliCommand,
} from './cli-test.harness';

type ClaimAccount = (context: AuthenticatedContext, input: ClaimAccountRequest) => Promise<ClaimAccountResponse>;
type PromptLoginEmail = (io: CliIo, configuredEmail: string | undefined) => Promise<string>;
type PromptNewPassword = (io: CliIo, label?: string) => Promise<string>;
type ReadCliConfig = () => Promise<CliConfig>;
type WriteCliConfig = (config: CliConfig) => Promise<void>;

interface ClaimCommandMocks {
  writeCliConfigMock: Mock<WriteCliConfig>;
}

interface ClaimCommandMocksInput {
  error?: Error | undefined;
  response?: ClaimAccountResponse | undefined;
}

const storedConfig: CliConfig = createCliConfigFixture({
  apiUrl: 'https://api.example',
  currentOrganization: createCliOrganizationFixture({ id: 'org_agent', name: 'Agent Org', slug: 'agent-org' }),
  principalEmail: 'prn_generated@signup.example.com',
  sessionToken: 'signup-session-token',
});

describe.sequential('compartment auth claim command', (): void => {
  beforeEach((): void => {
    resetCliCommandModules();
  });

  afterEach((): void => {
    restoreCliCommandModules([
      '../src/prompts/prompt',
      '../src/services/claim-account.service',
      '../src/store/config.store',
    ]);
  });

  it('claims the account with the session signup stored and refreshes the cached email', async (): Promise<void> => {
    const mocks: ClaimCommandMocks = mockClaimCommandModules({ response: createClaimResponse() });
    const capture: CliCommandCapture = createCliCapture();

    const result: CliCommandResult = await runCliCommand(['auth', 'claim', '--email', 'owner@example.com'], capture);

    expectCliSuccess(result);
    expect(readCliStdout(capture)).toContain('owner@example.com');
    expect(mocks.writeCliConfigMock).toHaveBeenCalledWith({
      currentRemote: 'default',
      remotes: {
        default: {
          apiUrl: 'https://api.example',
          currentOrganization: { id: 'org_agent', name: 'Agent Org', slug: 'agent-org' },
          principalEmail: 'owner@example.com',
          sessionToken: 'signup-session-token',
        },
      },
    });
  });

  it('keeps the cached email untouched when the address is already taken', async (): Promise<void> => {
    const mocks: ClaimCommandMocks = mockClaimCommandModules({
      error: new Error('An account with this email address already exists.'),
    });

    const result: CliCommandResult = await runCliCommand(
      ['auth', 'claim', '--email', 'owner@example.com'],
      createCliCapture(),
    );

    expectCliFailure(result, 'An account with this email address already exists.');
    expect(mocks.writeCliConfigMock).not.toHaveBeenCalled();
  });
});

function createClaimResponse(): ClaimAccountResponse {
  return {
    principal: {
      email: 'owner@example.com',
      id: 'prn_agent',
      type: 'user',
    },
  };
}

function mockClaimCommandModules(input: ClaimCommandMocksInput): ClaimCommandMocks {
  const promptLoginEmailMock: Mock<PromptLoginEmail> = vi.fn<PromptLoginEmail>().mockResolvedValue('owner@example.com');
  const promptNewPasswordMock: Mock<PromptNewPassword> = vi
    .fn<PromptNewPassword>()
    .mockResolvedValue('claimed-password-1');
  const readCliConfigMock: Mock<ReadCliConfig> = vi.fn<ReadCliConfig>().mockResolvedValue(storedConfig);
  const writeCliConfigMock: Mock<WriteCliConfig> = vi.fn<WriteCliConfig>().mockResolvedValue(undefined);
  const claimAccountMock: Mock<ClaimAccount> =
    input.error === undefined
      ? vi.fn<ClaimAccount>().mockResolvedValue(input.response!)
      : vi.fn<ClaimAccount>().mockRejectedValue(input.error);

  vi.doMock(
    '../src/prompts/prompt',
    (): { promptLoginEmail: Mock<PromptLoginEmail>; promptNewPassword: Mock<PromptNewPassword> } => ({
      promptLoginEmail: promptLoginEmailMock,
      promptNewPassword: promptNewPasswordMock,
    }),
  );
  vi.doMock('../src/services/claim-account.service', (): { claimAccount: Mock<ClaimAccount> } => ({
    claimAccount: claimAccountMock,
  }));
  vi.doMock(
    '../src/store/config.store',
    (): { readCliConfig: Mock<ReadCliConfig>; writeCliConfig: Mock<WriteCliConfig> } => ({
      readCliConfig: readCliConfigMock,
      writeCliConfig: writeCliConfigMock,
    }),
  );

  return { writeCliConfigMock };
}
