import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import {
  organizationSettingsResponseSchema,
  type OrganizationSettingsResponse,
  type UpdateOrganizationSettingsRequest,
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

interface OrganizationSettingsCommandMocks {
  readCliConfigMock: Mock<ReadCliConfig>;
  readOrganizationSettingsMock: Mock<ReadOrganizationSettings>;
  updateCurrentOrganizationSettingsMock: Mock<UpdateCurrentOrganizationSettings>;
}

interface OrganizationSettingsServiceModule {
  readOrganizationSettings: Mock<ReadOrganizationSettings>;
  updateCurrentOrganizationSettings: Mock<UpdateCurrentOrganizationSettings>;
}

interface ConfigStoreModule {
  readCliConfig: Mock<ReadCliConfig>;
}

type ReadCliConfig = () => Promise<CliConfig>;
type ReadOrganizationSettings = (context: AuthenticatedContext) => Promise<OrganizationSettingsResponse>;
type UpdateCurrentOrganizationSettings = (
  context: AuthenticatedContext,
  input: UpdateOrganizationSettingsRequest,
) => Promise<OrganizationSettingsResponse>;

describe.sequential('compartment organization settings commands', (): void => {
  beforeEach((): void => {
    resetCliCommandModules();
  });

  afterEach((): void => {
    restoreCliCommandModules(['../src/services/organization-settings.service', '../src/store/config.store']);
  });

  it('emits the organization settings JSON contract', async (): Promise<void> => {
    const mocks: OrganizationSettingsCommandMocks = mockOrganizationSettingsCommandModules();
    mocks.readOrganizationSettingsMock.mockResolvedValue(createOrganizationSettingsResponse());

    const result: CliJsonResult<OrganizationSettingsResponse> = await runCliJson(
      ['org', 'settings', 'get', '--output', 'json'],
      organizationSettingsResponseSchema,
    );

    expectCliSuccess(result);
    expect(result.payload.settings.auditRetention.effective).toEqual({
      days: 90,
      mode: 'keep_days',
    });
    expect(result.payload.settings.rollbackRetention.effective).toEqual({
      limit: 5,
      mode: 'keep_last',
    });
  });

  it('passes rollback retention changes to the service', async (): Promise<void> => {
    const mocks: OrganizationSettingsCommandMocks = mockOrganizationSettingsCommandModules();
    mocks.updateCurrentOrganizationSettingsMock.mockResolvedValue(
      createOrganizationSettingsResponse({
        settings: {
          auditRetention: {
            configured: {
              days: null,
              mode: 'inherit',
            },
            effective: {
              days: 90,
              mode: 'keep_days',
            },
            instanceDefault: {
              days: 90,
              mode: 'keep_days',
            },
          },
          rollbackRetention: {
            configured: {
              limit: 3,
              mode: 'keep_last',
            },
            effective: {
              limit: 3,
              mode: 'keep_last',
            },
            instanceDefault: {
              limit: 5,
              mode: 'keep_last',
            },
          },
        },
      }),
    );
    const capture: CliCommandCapture = createCliCapture();

    const result: CliCommandResult = await runCliCommand(
      ['org', 'settings', 'set', '--rollback-retention', '3'],
      capture,
    );

    expectCliSuccess(result);
    expect(mocks.updateCurrentOrganizationSettingsMock).toHaveBeenCalledWith(expect.anything(), {
      rollbackRetention: {
        limit: 3,
        mode: 'keep_last',
      },
    });
    expect(readCliStdout(capture)).toContain('Rollback retention configured: keep last 3.');
    expect(readCliStdout(capture)).toContain('Rollback retention effective: keep last 3.');
    expect(readCliStdout(capture)).toContain('Audit retention configured: inherit.');
  });

  it('rejects non-numeric rollback retention values', async (): Promise<void> => {
    const mocks: OrganizationSettingsCommandMocks = mockOrganizationSettingsCommandModules();

    const result: CliCommandResult = await runCliCommand(['org', 'settings', 'set', '--rollback-retention', '5days']);

    expectCliFailure(result, 'rollback retention must be inherit, indefinite, or a positive integer.');
    expect(mocks.updateCurrentOrganizationSettingsMock).not.toHaveBeenCalled();
  });
});

function createOrganizationSettingsResponse(
  overrides?: Partial<OrganizationSettingsResponse>,
): OrganizationSettingsResponse {
  return {
    settings: {
      auditRetention: {
        configured: {
          days: null,
          mode: 'inherit',
        },
        effective: {
          days: 90,
          mode: 'keep_days',
        },
        instanceDefault: {
          days: 90,
          mode: 'keep_days',
        },
      },
      rollbackRetention: {
        configured: {
          limit: null,
          mode: 'inherit',
        },
        effective: {
          limit: 5,
          mode: 'keep_last',
        },
        instanceDefault: {
          limit: 5,
          mode: 'keep_last',
        },
      },
    },
    ...overrides,
  };
}

function mockOrganizationSettingsCommandModules(): OrganizationSettingsCommandMocks {
  const readCliConfigMock: Mock<ReadCliConfig> = vi.fn<ReadCliConfig>().mockResolvedValue(createCliConfigFixture());
  const readOrganizationSettingsMock: Mock<ReadOrganizationSettings> = vi.fn<ReadOrganizationSettings>();
  const updateCurrentOrganizationSettingsMock: Mock<UpdateCurrentOrganizationSettings> =
    vi.fn<UpdateCurrentOrganizationSettings>();

  vi.doMock(
    '../src/services/organization-settings.service',
    (): OrganizationSettingsServiceModule => ({
      readOrganizationSettings: readOrganizationSettingsMock,
      updateCurrentOrganizationSettings: updateCurrentOrganizationSettingsMock,
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
    readOrganizationSettingsMock,
    updateCurrentOrganizationSettingsMock,
  };
}
