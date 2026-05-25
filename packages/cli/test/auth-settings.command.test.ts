import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import {
  organizationAuthSettingsResponseSchema,
  type OrganizationAuthSettingsResponse,
  type UpdateOrganizationAuthSettingsRequest,
} from '@compartment/contracts';
import type { AuthenticatedContext } from '../src/services/context.types';
import type { CliConfig } from '../src/store/config.types';
import { createCliConfigFixture } from './cli-test.fixtures';
import {
  type CliCommandCapture,
  type CliCommandResult,
  type CliJsonResult,
  createCliCapture,
  expectCliSuccess,
  readCliStdout,
  resetCliCommandModules,
  restoreCliCommandModules,
  runCliCommand,
  runCliJson,
} from './cli-test.harness';

interface AuthSettingsCommandMocks {
  readCliConfigMock: Mock<ReadCliConfig>;
  readOrganizationAuthSettingsMock: Mock<ReadOrganizationAuthSettings>;
  updateCurrentOrganizationAuthSettingsMock: Mock<UpdateCurrentOrganizationAuthSettings>;
}

interface OrganizationAuthSettingsServiceModule {
  readOrganizationAuthSettings: Mock<ReadOrganizationAuthSettings>;
  updateCurrentOrganizationAuthSettings: Mock<UpdateCurrentOrganizationAuthSettings>;
}

interface ConfigStoreModule {
  readCliConfig: Mock<ReadCliConfig>;
}

type ReadCliConfig = () => Promise<CliConfig>;
type ReadOrganizationAuthSettings = (context: AuthenticatedContext) => Promise<OrganizationAuthSettingsResponse>;
type UpdateCurrentOrganizationAuthSettings = (
  context: AuthenticatedContext,
  input: UpdateOrganizationAuthSettingsRequest,
) => Promise<OrganizationAuthSettingsResponse>;

describe.sequential('compartment auth settings commands', (): void => {
  beforeEach((): void => {
    resetCliCommandModules();
  });

  afterEach((): void => {
    restoreCliCommandModules(['../src/services/organization-auth-settings.service', '../src/store/config.store']);
  });

  it('emits the auth settings JSON contract', async (): Promise<void> => {
    const mocks: AuthSettingsCommandMocks = mockAuthSettingsCommandModules();
    mocks.readOrganizationAuthSettingsMock.mockResolvedValue(createAuthSettingsResponse(true));
    const result: CliJsonResult<OrganizationAuthSettingsResponse> = await runCliJson(
      ['auth', 'settings', 'get', '--output', 'json'],
      organizationAuthSettingsResponseSchema,
    );

    expectCliSuccess(result);
    expect(result.payload.settings.localPasswordEnabled).toBe(true);
  });

  it('passes password state changes to the service', async (): Promise<void> => {
    const mocks: AuthSettingsCommandMocks = mockAuthSettingsCommandModules();
    mocks.updateCurrentOrganizationAuthSettingsMock.mockResolvedValue(createAuthSettingsResponse(false));
    const capture: CliCommandCapture = createCliCapture();
    const result: CliCommandResult = await runCliCommand(
      ['auth', 'settings', 'set', '--password', 'disabled'],
      capture,
    );

    expectCliSuccess(result);
    expect(readCliStdout(capture)).toContain('Password login is disabled for the current organization.');
  });
});

function createAuthSettingsResponse(localPasswordEnabled: boolean): OrganizationAuthSettingsResponse {
  return {
    settings: {
      localPasswordEnabled,
    },
  };
}

function mockAuthSettingsCommandModules(): AuthSettingsCommandMocks {
  const readCliConfigMock: Mock<ReadCliConfig> = vi.fn<ReadCliConfig>().mockResolvedValue(createCliConfigFixture());
  const readOrganizationAuthSettingsMock: Mock<ReadOrganizationAuthSettings> = vi.fn<ReadOrganizationAuthSettings>();
  const updateCurrentOrganizationAuthSettingsMock: Mock<UpdateCurrentOrganizationAuthSettings> =
    vi.fn<UpdateCurrentOrganizationAuthSettings>();

  vi.doMock(
    '../src/services/organization-auth-settings.service',
    (): OrganizationAuthSettingsServiceModule => ({
      readOrganizationAuthSettings: readOrganizationAuthSettingsMock,
      updateCurrentOrganizationAuthSettings: updateCurrentOrganizationAuthSettingsMock,
    }),
  );
  vi.doMock(
    '../src/store/config.store',
    (): ConfigStoreModule => ({
      readCliConfig: readCliConfigMock,
    }),
  );

  return {
    readCliConfigMock,
    readOrganizationAuthSettingsMock,
    updateCurrentOrganizationAuthSettingsMock,
  };
}
