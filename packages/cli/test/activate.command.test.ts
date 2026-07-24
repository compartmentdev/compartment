import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { activateResponseSchema, type ActivateResponse } from '@compartment/contracts';
import type { CliIo } from '../src/app.types';
import type { CliConfig } from '../src/store/config.types';
import type { ApiContext } from '../src/services/context.types';
import { createCliConfigFixture, createCliOrganizationFixture } from './cli-test.fixtures';
import {
  type CliCommandCapture,
  type CliCommandResult,
  type CliJsonResult,
  createCliCapture,
  expectCliFailure,
  expectCliSuccess,
  resetCliCommandModules,
  restoreCliCommandModules,
  runCliCommand,
  runCliJson,
} from './cli-test.harness';

interface ActivateCommandMocks {
  activateMock: Mock<Activate>;
  promptActivationTokenMock: Mock<PromptActivationToken>;
  promptLoginEmailMock: Mock<PromptLoginEmail>;
  promptNewPasswordMock: Mock<PromptNewPassword>;
  promptRemoteNameMock: Mock<PromptRemoteName>;
  readCliConfigMock: Mock<ReadCliConfig>;
  writeCliConfigMock: Mock<WriteCliConfig>;
}

interface ActivateCommandPromptModule {
  promptActivationToken: Mock<PromptActivationToken>;
  promptLoginEmail: Mock<PromptLoginEmail>;
  promptNewPassword: Mock<PromptNewPassword>;
  promptRemoteName: Mock<PromptRemoteName>;
}

interface ActivateCommandServiceModule {
  activate: Mock<Activate>;
}

interface ActivateCommandConfigStoreModule {
  readCliConfig: Mock<ReadCliConfig>;
  writeCliConfig: Mock<WriteCliConfig>;
}

type Activate = (
  context: ApiContext,
  input: {
    bootstrapToken: string;
    email: string;
    password: string;
  },
) => Promise<ActivateResponse>;
type PromptActivationToken = (io: CliIo, configuredToken: string | undefined) => Promise<string>;
type PromptLoginEmail = (io: CliIo, initialEmail: string | undefined) => Promise<string>;
type PromptNewPassword = (io: CliIo, label?: string) => Promise<string>;
type PromptRemoteName = (io: CliIo, initialRemoteName: string) => Promise<string>;
type ReadCliConfig = () => Promise<CliConfig>;
type WriteCliConfig = (config: CliConfig) => Promise<void>;

const commandTestTimeoutMs: number = 10000;
const viewerPasswordEnvName: string = 'COMPARTMENT_VIEWER_PASSWORD';
const originalViewerPassword: string | undefined = process.env[viewerPasswordEnvName];

interface SuccessfulMockActivateCommandModulesInput {
  config: Partial<CliConfig>;
  error?: undefined;
  response: ActivateResponse;
}

interface FailedMockActivateCommandModulesInput {
  config: Partial<CliConfig>;
  error: Error;
  response?: undefined;
}

type MockActivateCommandModulesInput =
  | FailedMockActivateCommandModulesInput
  | SuccessfulMockActivateCommandModulesInput;

describe.sequential('compartment activate command', (): void => {
  beforeEach((): void => {
    delete process.env[viewerPasswordEnvName];
    resetCliCommandModules();
  });

  afterEach((): void => {
    if (originalViewerPassword === undefined) {
      delete process.env[viewerPasswordEnvName];
    } else {
      process.env[viewerPasswordEnvName] = originalViewerPassword;
    }
    restoreCliCommandModules([
      '../src/prompts/prompt',
      '../src/services/activation.service',
      '../src/store/config.store',
    ]);
  });

  it(
    'activates an invited user and persists the new session config',
    async (): Promise<void> => {
      const response: ActivateResponse = createActivateResponse();
      const mocks: ActivateCommandMocks = mockActivateCommandModules({
        config: createCliConfigFixture({
          apiUrl: 'https://stored.example',
          currentOrganization: createCliOrganizationFixture({
            id: 'org_1',
            name: 'Acme Dev',
            slug: 'acme-dev',
          }),
        }),
        response,
      });
      const capture: CliCommandCapture = createCliCapture();
      const result: CliJsonResult<ActivateResponse> = await runCliJson(
        [
          'activate',
          '--api-url',
          'https://api.example',
          '--remote',
          'default',
          '--email',
          'viewer@example.com',
          '--token',
          'invite-token',
          '--output',
          'json',
        ],
        activateResponseSchema,
        capture,
      );

      expectCliSuccess(result);
      expect(mocks.promptLoginEmailMock).toHaveBeenCalledWith(capture.io, 'viewer@example.com');
      expect(mocks.promptActivationTokenMock).toHaveBeenCalledWith(capture.io, 'invite-token');
      expect(mocks.promptNewPasswordMock).toHaveBeenCalledWith(capture.io, 'Password');
      expect(mocks.activateMock).toHaveBeenCalledWith(
        { apiUrl: 'https://api.example' },
        {
          bootstrapToken: 'invite-token',
          email: 'viewer@example.com',
          password: 'viewersecretpassword',
        },
      );
      expect(result.payload).toEqual(response);
      expect(mocks.writeCliConfigMock).toHaveBeenCalledWith({
        currentRemote: 'default',
        remotes: {
          default: {
            apiUrl: 'https://api.example',
            currentOrganization: {
              id: 'org_1',
              name: 'Acme Dev',
              slug: 'acme-dev',
            },
            principalEmail: 'viewer@example.com',
            sessionToken: 'session_456',
          },
        },
      });
    },
    commandTestTimeoutMs,
  );

  it('uses COMPARTMENT_VIEWER_PASSWORD without prompting', async (): Promise<void> => {
    process.env[viewerPasswordEnvName] = 'configured-viewer-password';
    const mocks: ActivateCommandMocks = mockActivateCommandModules({
      config: {},
      response: createActivateResponse(),
    });

    const result: CliCommandResult = await runCliCommand(
      ['activate', '--api-url', 'https://api.example', '--email', 'viewer@example.com', '--token', 'invite-token'],
      createCliCapture(),
    );

    expectCliSuccess(result);
    expect(mocks.promptNewPasswordMock).not.toHaveBeenCalled();
    expect(mocks.activateMock).toHaveBeenCalledWith(
      { apiUrl: 'https://api.example' },
      {
        bootstrapToken: 'invite-token',
        email: 'viewer@example.com',
        password: 'configured-viewer-password',
      },
    );
  });

  it('rejects an invalid configured viewer password without prompting', async (): Promise<void> => {
    process.env[viewerPasswordEnvName] = 'short';
    const mocks: ActivateCommandMocks = mockActivateCommandModules({
      config: {},
      response: createActivateResponse(),
    });

    const result: CliCommandResult = await runCliCommand(
      ['activate', '--api-url', 'https://api.example'],
      createCliCapture(),
    );

    expectCliFailure(result, 'COMPARTMENT_VIEWER_PASSWORD: Password must be at least 8 characters.');
    expect(mocks.promptNewPasswordMock).not.toHaveBeenCalled();
    expect(mocks.activateMock).not.toHaveBeenCalled();
  });

  it('returns activation service errors without writing config', async (): Promise<void> => {
    const mocks: ActivateCommandMocks = mockActivateCommandModules({
      config: {},
      error: new Error('The invitation token is invalid or expired.'),
    });
    const result: CliCommandResult = await runCliCommand(
      ['activate', '--api-url', 'https://api.example'],
      createCliCapture(),
    );

    expectCliFailure(result, 'The invitation token is invalid or expired.');
    expect(mocks.writeCliConfigMock).not.toHaveBeenCalled();
  });

  it('does not reuse the stored email when creating a remote for a different URL', async (): Promise<void> => {
    const mocks: ActivateCommandMocks = mockActivateCommandModules({
      config: createCliConfigFixture({
        apiUrl: 'https://stored.example',
        principalEmail: 'stored@example.com',
      }),
      response: createActivateResponse(),
    });
    const capture: CliCommandCapture = createCliCapture();

    const result: CliCommandResult = await runCliCommand(['activate', '--api-url', 'https://api.example'], capture);

    expectCliSuccess(result);
    expect(mocks.promptRemoteNameMock).toHaveBeenCalledWith(capture.io, 'default-2');
    expect(mocks.promptLoginEmailMock).toHaveBeenCalledWith(capture.io, undefined);
  });
});

function createActivateResponse(): ActivateResponse {
  return {
    organizations: [
      {
        id: 'org_1',
        name: 'Acme Dev',
        slug: 'acme-dev',
      },
    ],
    principal: {
      email: 'viewer@example.com',
      id: 'usr_456',
      type: 'user',
    },
    sessionToken: 'session_456',
  };
}

function mockActivateCommandModules(input: MockActivateCommandModulesInput): ActivateCommandMocks {
  const readCliConfigMock: Mock<ReadCliConfig> = vi.fn<ReadCliConfig>().mockResolvedValue(input.config);
  const writeCliConfigMock: Mock<WriteCliConfig> = vi.fn<WriteCliConfig>().mockResolvedValue(undefined);
  const promptActivationTokenMock: Mock<PromptActivationToken> = vi
    .fn<PromptActivationToken>()
    .mockResolvedValue('invite-token');
  const promptLoginEmailMock: Mock<PromptLoginEmail> = vi
    .fn<PromptLoginEmail>()
    .mockResolvedValue('viewer@example.com');
  const promptNewPasswordMock: Mock<PromptNewPassword> = vi
    .fn<PromptNewPassword>()
    .mockResolvedValue('viewersecretpassword');
  const promptRemoteNameMock: Mock<PromptRemoteName> = vi.fn<PromptRemoteName>().mockResolvedValue('default-2');
  const activateMock: Mock<Activate> =
    input.error === undefined
      ? vi.fn<Activate>().mockResolvedValue(input.response)
      : vi.fn<Activate>().mockRejectedValue(input.error);

  vi.doMock(
    '../src/prompts/prompt',
    (): ActivateCommandPromptModule => ({
      promptActivationToken: promptActivationTokenMock,
      promptLoginEmail: promptLoginEmailMock,
      promptNewPassword: promptNewPasswordMock,
      promptRemoteName: promptRemoteNameMock,
    }),
  );
  vi.doMock(
    '../src/services/activation.service',
    (): ActivateCommandServiceModule => ({
      activate: activateMock,
    }),
  );
  vi.doMock(
    '../src/store/config.store',
    (): ActivateCommandConfigStoreModule => ({
      readCliConfig: readCliConfigMock,
      writeCliConfig: writeCliConfigMock,
    }),
  );

  return {
    activateMock,
    promptActivationTokenMock,
    promptLoginEmailMock,
    promptNewPasswordMock,
    promptRemoteNameMock,
    readCliConfigMock,
    writeCliConfigMock,
  };
}
