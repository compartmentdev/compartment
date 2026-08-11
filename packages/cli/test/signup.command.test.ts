import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { SignupRequest, SignupResponse } from '@compartment/contracts';
import type { CliIo } from '../src/app.types';
import type { ApiContext } from '../src/services/context.types';
import type { CliConfig } from '../src/store/config.types';
import {
  type CliCommandCapture,
  type CliCommandResult,
  createCliCapture,
  expectCliFailure,
  expectCliSuccess,
  mockManagedCloudControlPlaneUrl,
  readCliStderr,
  readCliStdout,
  resetCliCommandModules,
  restoreCliCommandModules,
  runCliCommand,
} from './cli-test.harness';

type PromptOrganizationName = (io: CliIo, configuredOrganization: string | undefined) => Promise<string>;
type ReadCliConfig = () => Promise<CliConfig>;
type SignUp = (context: ApiContext, input: SignupRequest) => Promise<SignupResponse>;
type WriteCliConfig = (config: CliConfig) => Promise<void>;

interface SignupCommandMocks {
  promptOrganizationNameMock: Mock<PromptOrganizationName>;
  readCliConfigMock: Mock<ReadCliConfig>;
  signUpMock: Mock<SignUp>;
  writeCliConfigMock: Mock<WriteCliConfig>;
}

interface SignupCommandMocksInput {
  config?: CliConfig | undefined;
  error?: Error | undefined;
  response?: SignupResponse | undefined;
}

describe.sequential('compartment signup command', (): void => {
  beforeEach((): void => {
    resetCliCommandModules();
  });

  afterEach((): void => {
    restoreCliCommandModules([
      '@compartment/contracts',
      '../src/prompts/prompt',
      '../src/services/signup.service',
      '../src/store/config.store',
    ]);
  });

  it('prefers an explicit API URL without announcing the managed cloud', async (): Promise<void> => {
    mockManagedCloudControlPlaneUrl('https://cloud.example.com');
    const mocks: SignupCommandMocks = mockSignupCommandModules({
      config: {
        currentRemote: 'default',
        remotes: {
          default: {
            apiUrl: 'https://stored.example.com',
          },
        },
      },
      response: createSignupResponse(),
    });
    const capture: CliCommandCapture = createCliCapture();

    const result: CliCommandResult = await runCliCommand(
      [
        'signup',
        '--api-url',
        'https://api.example',
        '--remote',
        'default',
        '--email',
        'agent@example.com',
        '--organization',
        'Agent Org',
      ],
      capture,
    );

    expectCliSuccess(result);
    expect(mocks.signUpMock).toHaveBeenCalledWith(
      { apiUrl: 'https://api.example' },
      { email: 'agent@example.com', organizationName: 'Agent Org' },
    );
    expect(mocks.writeCliConfigMock).toHaveBeenCalledWith({
      currentRemote: 'default',
      remotes: {
        default: {
          apiUrl: 'https://api.example',
          currentOrganization: { id: 'org_agent', name: 'Agent Org', slug: 'agent-org' },
          principalEmail: 'agent@example.com',
          sessionToken: 'signup-session-token',
        },
      },
    });
    expect(readCliStderr(capture)).not.toContain('Using Compartment Cloud');
    expect(readCliStdout(capture)).toContain('agent-org');
  });

  it('uses the selected stored remote without announcing the managed cloud', async (): Promise<void> => {
    mockManagedCloudControlPlaneUrl('https://cloud.example.com');
    const mocks: SignupCommandMocks = mockSignupCommandModules({
      config: {
        currentRemote: 'lab',
        remotes: {
          lab: {
            apiUrl: 'https://stored.example.com',
          },
        },
      },
      response: createSignupResponse(),
    });
    const capture: CliCommandCapture = createCliCapture();

    const result: CliCommandResult = await runCliCommand(['signup'], capture);

    expectCliSuccess(result);
    expect(mocks.signUpMock).toHaveBeenCalledWith(
      { apiUrl: 'https://stored.example.com' },
      { organizationName: 'Agent Org' },
    );
    expect(readCliStderr(capture)).not.toContain('Using Compartment Cloud');
  });

  it('uses and announces the managed cloud when no API URL is configured', async (): Promise<void> => {
    mockManagedCloudControlPlaneUrl('https://cloud.example.com/control-plane');
    const mocks: SignupCommandMocks = mockSignupCommandModules({ response: createSignupResponse() });
    const capture: CliCommandCapture = createCliCapture();

    const result: CliCommandResult = await runCliCommand(['signup'], capture);

    expectCliSuccess(result);
    expect(mocks.signUpMock).toHaveBeenCalledWith(
      { apiUrl: 'https://cloud.example.com/control-plane' },
      { organizationName: 'Agent Org' },
    );
    expect(readCliStderr(capture)).toBe('Using Compartment Cloud at cloud.example.com.\n');
  });

  it('keeps the API URL guidance when the managed cloud URL is unset', async (): Promise<void> => {
    mockManagedCloudControlPlaneUrl(undefined);
    const mocks: SignupCommandMocks = mockSignupCommandModules({ response: createSignupResponse() });

    const result: CliCommandResult = await runCliCommand(
      ['signup', '--remote', 'lab', '--organization', 'Agent Org'],
      createCliCapture(),
    );

    expectCliFailure(result, 'API URL is required. Run `compartment login --remote lab --api-url <url>` first.');
    expect(mocks.signUpMock).not.toHaveBeenCalled();
    expect(mocks.writeCliConfigMock).not.toHaveBeenCalled();
  });

  it('stores the generated address when the agent signs up without an email', async (): Promise<void> => {
    const mocks: SignupCommandMocks = mockSignupCommandModules({
      response: createSignupResponse({ email: 'prn_generated@signup.example.com' }),
    });
    const capture: CliCommandCapture = createCliCapture();

    const result: CliCommandResult = await runCliCommand(
      ['signup', '--api-url', 'https://api.example', '--organization', 'Agent Org'],
      capture,
    );

    expectCliSuccess(result);
    expect(mocks.signUpMock).toHaveBeenCalledWith({ apiUrl: 'https://api.example' }, { organizationName: 'Agent Org' });
    expect(readCliStdout(capture)).toContain('compartment auth claim');
  });

  it('leaves the stored config untouched when signup is refused', async (): Promise<void> => {
    const mocks: SignupCommandMocks = mockSignupCommandModules({
      error: new Error('Self-service signup is disabled on this Compartment installation.'),
    });

    const result: CliCommandResult = await runCliCommand(
      ['signup', '--api-url', 'https://api.example', '--organization', 'Agent Org'],
      createCliCapture(),
    );

    expectCliFailure(result, 'Self-service signup is disabled on this Compartment installation.');
    expect(mocks.writeCliConfigMock).not.toHaveBeenCalled();
  });
});

function createSignupResponse(overrides: { email?: string } = {}): SignupResponse {
  return {
    organizations: [{ id: 'org_agent', name: 'Agent Org', slug: 'agent-org' }],
    principal: {
      email: overrides.email ?? 'agent@example.com',
      id: 'prn_agent',
      type: 'user',
    },
    sessionToken: 'signup-session-token',
  };
}

function mockSignupCommandModules(input: SignupCommandMocksInput): SignupCommandMocks {
  const promptOrganizationNameMock: Mock<PromptOrganizationName> = vi
    .fn<PromptOrganizationName>()
    .mockResolvedValue('Agent Org');
  const readCliConfigMock: Mock<ReadCliConfig> = vi.fn<ReadCliConfig>().mockResolvedValue(input.config ?? {});
  const writeCliConfigMock: Mock<WriteCliConfig> = vi.fn<WriteCliConfig>().mockResolvedValue(undefined);
  const signUpMock: Mock<SignUp> =
    input.error === undefined
      ? vi.fn<SignUp>().mockResolvedValue(input.response!)
      : vi.fn<SignUp>().mockRejectedValue(input.error);

  vi.doMock('../src/prompts/prompt', (): { promptOrganizationName: Mock<PromptOrganizationName> } => ({
    promptOrganizationName: promptOrganizationNameMock,
  }));
  vi.doMock('../src/services/signup.service', (): { signUp: Mock<SignUp> } => ({
    signUp: signUpMock,
  }));
  vi.doMock(
    '../src/store/config.store',
    (): { readCliConfig: Mock<ReadCliConfig>; writeCliConfig: Mock<WriteCliConfig> } => ({
      readCliConfig: readCliConfigMock,
      writeCliConfig: writeCliConfigMock,
    }),
  );

  return {
    promptOrganizationNameMock,
    readCliConfigMock,
    signUpMock,
    writeCliConfigMock,
  };
}
