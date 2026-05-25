import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { type WhoAmICommandResponse, type WhoAmIResponse, whoamiCommandResponseSchema } from '@compartment/contracts';
import type { CliConfig } from '../src/store/config.types';
import type { AuthenticatedContext } from '../src/services/context.types';
import { createCliConfigFixture } from './cli-test.fixtures';
import {
  type CliCommandResult,
  type CliJsonResult,
  expectCliSuccess,
  readCliStdout,
  resetCliCommandModules,
  restoreCliCommandModules,
  runCliCommand,
  runCliJson,
} from './cli-test.harness';

interface WhoAmICommandMocks {
  readCliConfigMock: Mock<ReadCliConfig>;
  runWhoAmIMock: Mock<RunWhoAmI>;
}

interface WhoAmICommandConfigStoreModule {
  readCliConfig: Mock<ReadCliConfig>;
}

interface WhoAmICommandServiceModule {
  runWhoAmI: Mock<RunWhoAmI>;
}

type ReadCliConfig = () => Promise<CliConfig>;
type RunWhoAmI = (context: AuthenticatedContext) => Promise<WhoAmIResponse>;

const commandTestTimeoutMs: number = 10000;

describe.sequential('compartment whoami command', (): void => {
  beforeEach((): void => {
    resetCliCommandModules();
  });

  afterEach((): void => {
    restoreCliCommandModules(['../src/services/whoami.service', '../src/store/config.store']);
  });

  it(
    'emits the CLI whoami payload with the authenticated API URL',
    async (): Promise<void> => {
      mockWhoAmICommandModules();
      const result: CliJsonResult<WhoAmICommandResponse> = await runCliJson(
        ['whoami', '--output', 'json'],
        whoamiCommandResponseSchema,
      );

      expectCliSuccess(result);
      const payload: WhoAmICommandResponse = result.payload;
      expect(payload).toEqual({
        apiUrl: 'https://remote.console.example',
        currentOrganization: {
          id: 'org_123',
          name: 'Acme Dev',
          slug: 'acme-dev',
        },
        principal: {
          email: 'owner@example.com',
          id: 'usr_123',
          type: 'user',
        },
        remoteName: 'default',
      });
    },
    commandTestTimeoutMs,
  );

  it('shows the authenticated API URL in text output', async (): Promise<void> => {
    mockWhoAmICommandModules();
    const result: CliCommandResult = await runCliCommand(['whoami']);

    expectCliSuccess(result);
    expect(readCliStdout(result.capture)).toContain(
      'Authenticated as owner@example.com in acme-dev against remote default at API https://remote.console.example',
    );
  });

  it('shows remote selection guidance when no remote is selected', async (): Promise<void> => {
    mockWhoAmICommandModules({
      remotes: {
        lab: {
          apiUrl: 'https://lab.console.example',
          sessionToken: 'lab-session',
        },
      },
    });
    const result: CliCommandResult = await runCliCommand(['whoami']);

    expect(result.exitCode).toBe(1);
    expect(readCliStdout(result.capture)).toBe('');
    expect(result.capture.stderr.join('')).toContain(
      'No remote is selected. Pass --remote <name> or run `compartment remote use <name>` first.',
    );
  });
});

function createWhoAmIResponse(): WhoAmIResponse {
  return {
    currentOrganization: {
      id: 'org_123',
      name: 'Acme Dev',
      slug: 'acme-dev',
    },
    currentOrganizationPermissions: ['organization.user.invite'],
    principal: {
      email: 'owner@example.com',
      id: 'usr_123',
      type: 'user',
    },
  };
}

function mockWhoAmICommandModules(
  config: CliConfig = createCliConfigFixture({
    apiUrl: 'https://remote.console.example',
    principalEmail: undefined,
  }),
): WhoAmICommandMocks {
  const readCliConfigMock: Mock<ReadCliConfig> = vi.fn<ReadCliConfig>().mockResolvedValue(config);
  const runWhoAmIMock: Mock<RunWhoAmI> = vi.fn<RunWhoAmI>().mockResolvedValue(createWhoAmIResponse());

  vi.doMock(
    '../src/store/config.store',
    (): WhoAmICommandConfigStoreModule => ({
      readCliConfig: readCliConfigMock,
    }),
  );
  vi.doMock(
    '../src/services/whoami.service',
    (): WhoAmICommandServiceModule => ({
      runWhoAmI: runWhoAmIMock,
    }),
  );

  return {
    readCliConfigMock,
    runWhoAmIMock,
  };
}
