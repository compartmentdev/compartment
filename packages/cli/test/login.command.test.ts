import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { loginResponseSchema, type LoginResponse } from '@compartment/contracts';
import type { CliIo } from '../src/app.types';
import type { ApiContext } from '../src/services/context.types';
import type { CliConfig } from '../src/store/config.types';
import { createCliConfigFixture, createCliOrganizationFixture, createLoginResponseFixture } from './cli-test.fixtures';
import {
  type CliCommandCapture,
  type CliCommandResult,
  type CliJsonResult,
  createCliCapture,
  expectCliFailure,
  expectCliSuccess,
  mockManagedCloudControlPlaneUrl,
  readCliStderr,
  resetCliCommandModules,
  restoreCliCommandModules,
  runCliCommand,
  runCliJson,
} from './cli-test.harness';

interface LoginCommandMocks {
  performLoginCommandFlowMock: Mock<PerformLoginCommandFlow>;
  promptRemoteNameMock: Mock<PromptRemoteName>;
  readCliConfigMock: Mock<ReadCliConfig>;
  writeCliConfigMock: Mock<WriteCliConfig>;
}

interface LoginCommandPromptModule {
  promptRemoteName: Mock<PromptRemoteName>;
}

interface LoginCommandFlowModule {
  performLoginCommandFlow: Mock<PerformLoginCommandFlow>;
}

interface LoginCommandConfigStoreModule {
  readCliConfig: Mock<ReadCliConfig>;
  writeCliConfig: Mock<WriteCliConfig>;
}

type PerformLoginCommandFlow = (
  dependencies: { io: CliIo },
  context: ApiContext,
  email?: string,
  onboardingSessionId?: string,
  organizationSlug?: string,
) => Promise<LoginResponse>;
type PromptRemoteName = (io: CliIo, initialRemoteName: string) => Promise<string>;
type ReadCliConfig = () => Promise<CliConfig>;
type WriteCliConfig = (config: CliConfig) => Promise<void>;

const commandTestTimeoutMs: number = 10000;

interface SuccessfulMockLoginCommandModulesInput {
  config: Partial<CliConfig>;
  error?: undefined;
  response: LoginResponse;
}

interface FailedMockLoginCommandModulesInput {
  config: Partial<CliConfig>;
  error: Error;
  response?: undefined;
}

type MockLoginCommandModulesInput = SuccessfulMockLoginCommandModulesInput | FailedMockLoginCommandModulesInput;

describe.sequential('compartment login command', (): void => {
  beforeEach((): void => {
    resetCliCommandModules();
  });

  afterEach((): void => {
    restoreCliCommandModules([
      '@compartment/contracts',
      '../src/prompts/prompt',
      '../src/commands/auth/login.command.flow',
      '../src/store/config.store',
    ]);
  });

  it('uses and announces the managed cloud when logging in without flags', async (): Promise<void> => {
    mockManagedCloudControlPlaneUrl('https://cloud.example.com/control-plane');
    const response: LoginResponse = createLoginResponseFixture();
    const mocks: LoginCommandMocks = mockLoginCommandModules({
      config: {},
      response,
    });
    const capture: CliCommandCapture = createCliCapture();

    const result: CliCommandResult = await runCliCommand(['login'], capture);

    expectCliSuccess(result);
    expect(mocks.performLoginCommandFlowMock).toHaveBeenCalledWith(
      expect.objectContaining({ io: capture.io }),
      { apiUrl: 'https://cloud.example.com/control-plane' },
      undefined,
      undefined,
      undefined,
    );
    expect(readCliStderr(capture)).toContain('Using Compartment Cloud at cloud.example.com.\n');
    expect(mocks.writeCliConfigMock).toHaveBeenCalledWith({
      currentRemote: 'default',
      remotes: {
        default: {
          apiUrl: 'https://cloud.example.com/control-plane',
          currentOrganization: {
            id: 'org_123',
            name: 'Acme Dev',
            slug: 'acme-dev',
          },
          principalEmail: 'owner@example.com',
          sessionToken: 'session-token',
        },
      },
    });
  });

  it(
    'passes parsed options to the service and emits the login JSON contract',
    async (): Promise<void> => {
      const response: LoginResponse = createLoginResponseFixture({
        organizations: [
          {
            id: 'org_1',
            name: 'Acme',
            slug: 'acme',
          },
          {
            id: 'org_2',
            name: 'Finance',
            slug: 'finance',
          },
        ],
        sessionToken: 'session_123',
      });
      const mocks: LoginCommandMocks = mockLoginCommandModules({
        config: createCliConfigFixture({
          apiUrl: 'https://stored.example',
          currentOrganization: createCliOrganizationFixture({
            id: 'org_2',
            name: 'Finance',
            slug: 'finance',
          }),
          principalEmail: 'stored@example.com',
          sessionToken: 'old_session',
        }),
        response,
      });
      const capture: CliCommandCapture = createCliCapture();
      const result: CliJsonResult<LoginResponse> = await runCliJson(
        [
          'login',
          '--api-url',
          'https://api.example',
          '--remote',
          'default',
          '--email',
          'owner@example.com',
          '--onboarding-session',
          'fdo_123',
          '--organization',
          'acme',
          '--output',
          'json',
        ],
        loginResponseSchema,
        capture,
      );

      expectCliSuccess(result);
      expect(mocks.performLoginCommandFlowMock).toHaveBeenCalledWith(
        expect.objectContaining({ io: capture.io }),
        { apiUrl: 'https://api.example' },
        'owner@example.com',
        'fdo_123',
        'acme',
      );
      expect(result.payload).toEqual(response);
      expect(mocks.writeCliConfigMock).toHaveBeenCalledWith({
        currentRemote: 'default',
        remotes: {
          default: {
            apiUrl: 'https://api.example',
            firstDeployOnboardingSessionId: 'fdo_123',
            currentOrganization: {
              id: 'org_1',
              name: 'Acme',
              slug: 'acme',
            },
            principalEmail: 'owner@example.com',
            sessionToken: 'session_123',
          },
        },
      });
    },
    commandTestTimeoutMs,
  );

  it('returns service errors without writing config', async (): Promise<void> => {
    const mocks: LoginCommandMocks = mockLoginCommandModules({
      config: {},
      error: new Error('Invalid credentials.'),
    });
    const result: CliCommandResult = await runCliCommand(
      ['login', '--api-url', 'https://api.example'],
      createCliCapture(),
    );

    expectCliFailure(result, 'Invalid credentials.');
    expect(mocks.writeCliConfigMock).not.toHaveBeenCalled();
  });

  it('fails in json mode when an inferred remote points at a different URL', async (): Promise<void> => {
    const mocks: LoginCommandMocks = mockLoginCommandModules({
      config: createCliConfigFixture({
        apiUrl: 'https://stored.example',
      }),
      response: createLoginResponseFixture(),
    });
    const result: CliCommandResult = await runCliCommand(
      ['login', '--api-url', 'https://api.example', '--output', 'json'],
      createCliCapture(),
    );

    expectCliFailure(
      result,
      'Current CLI remote "default" points to https://stored.example. Pass --remote <name> for the new URL.',
    );
    expect(mocks.performLoginCommandFlowMock).not.toHaveBeenCalled();
    expect(mocks.writeCliConfigMock).not.toHaveBeenCalled();
  });

  it('does not reuse the stored email when creating a remote for a different URL', async (): Promise<void> => {
    const mocks: LoginCommandMocks = mockLoginCommandModules({
      config: createCliConfigFixture({
        apiUrl: 'https://stored.example',
        principalEmail: 'stored@example.com',
      }),
      response: createLoginResponseFixture(),
    });
    const capture: CliCommandCapture = createCliCapture();

    const result: CliCommandResult = await runCliCommand(['login', '--api-url', 'https://api.example'], capture);

    expectCliSuccess(result);
    expect(mocks.promptRemoteNameMock).toHaveBeenCalledWith(capture.io, 'default-2');
    expect(mocks.performLoginCommandFlowMock).toHaveBeenCalledWith(
      expect.objectContaining({ io: capture.io }),
      { apiUrl: 'https://api.example' },
      undefined,
      undefined,
      undefined,
    );
  });
});

function mockLoginCommandModules(input: MockLoginCommandModulesInput): LoginCommandMocks {
  const readCliConfigMock: Mock<ReadCliConfig> = vi.fn<ReadCliConfig>().mockResolvedValue(input.config);
  const writeCliConfigMock: Mock<WriteCliConfig> = vi.fn<WriteCliConfig>().mockResolvedValue(undefined);
  const promptRemoteNameMock: Mock<PromptRemoteName> = vi.fn<PromptRemoteName>().mockResolvedValue('default-2');
  const performLoginCommandFlowMock: Mock<PerformLoginCommandFlow> =
    input.error === undefined
      ? vi.fn<PerformLoginCommandFlow>().mockResolvedValue(input.response)
      : vi.fn<PerformLoginCommandFlow>().mockRejectedValue(input.error);

  vi.doMock(
    '../src/prompts/prompt',
    (): LoginCommandPromptModule => ({
      promptRemoteName: promptRemoteNameMock,
    }),
  );
  vi.doMock(
    '../src/commands/auth/login.command.flow',
    (): LoginCommandFlowModule => ({
      performLoginCommandFlow: performLoginCommandFlowMock,
    }),
  );
  vi.doMock(
    '../src/store/config.store',
    (): LoginCommandConfigStoreModule => ({
      readCliConfig: readCliConfigMock,
      writeCliConfig: writeCliConfigMock,
    }),
  );

  return {
    performLoginCommandFlowMock,
    promptRemoteNameMock,
    readCliConfigMock,
    writeCliConfigMock,
  };
}
