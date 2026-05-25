import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import {
  buildDefaultSsoOidcIdentityVerificationConfig,
  buildDisabledSsoOidcProvisioningPolicy,
  deleteSsoOidcProviderResponseSchema,
  ssoOidcProviderListResponseSchema,
  type ConfigureSsoOidcProviderRequest,
  type DeleteSsoOidcProviderResponse,
  type SsoOidcProviderListResponse,
  type SsoOidcProviderResponse,
  type UpdateSsoOidcProviderRequest,
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

interface SsoOidcCommandMocks {
  createOrganizationSsoOidcProviderMock: Mock<CreateOrganizationSsoOidcProvider>;
  deleteOrganizationSsoOidcProviderMock: Mock<DeleteOrganizationSsoOidcProvider>;
  readCliConfigMock: Mock<ReadCliConfig>;
  readOrganizationSsoOidcProvidersMock: Mock<ReadOrganizationSsoOidcProviders>;
  updateOrganizationSsoOidcProviderMock: Mock<UpdateOrganizationSsoOidcProvider>;
}

interface SsoOidcProviderServiceModule {
  createOrganizationSsoOidcProvider: Mock<CreateOrganizationSsoOidcProvider>;
  deleteOrganizationSsoOidcProvider: Mock<DeleteOrganizationSsoOidcProvider>;
  readOrganizationSsoOidcProviders: Mock<ReadOrganizationSsoOidcProviders>;
  updateOrganizationSsoOidcProvider: Mock<UpdateOrganizationSsoOidcProvider>;
}

interface ConfigStoreModule {
  readCliConfig: Mock<ReadCliConfig>;
}

type CreateOrganizationSsoOidcProvider = (
  context: AuthenticatedContext,
  input: ConfigureSsoOidcProviderRequest,
) => Promise<SsoOidcProviderResponse>;
type DeleteOrganizationSsoOidcProvider = (
  context: AuthenticatedContext,
  providerId: string,
) => Promise<DeleteSsoOidcProviderResponse>;
type ReadCliConfig = () => Promise<CliConfig>;
type ReadOrganizationSsoOidcProviders = (context: AuthenticatedContext) => Promise<SsoOidcProviderListResponse>;
type UpdateOrganizationSsoOidcProvider = (
  context: AuthenticatedContext,
  providerId: string,
  input: UpdateSsoOidcProviderRequest,
) => Promise<SsoOidcProviderResponse>;

describe.sequential('compartment SSO OIDC commands', (): void => {
  beforeEach((): void => {
    resetCliCommandModules();
  });

  afterEach((): void => {
    restoreCliCommandModules(['../src/services/sso-oidc-provider.service', '../src/store/config.store']);
  });

  it('emits the configured OIDC provider list JSON contract', async (): Promise<void> => {
    const mocks: SsoOidcCommandMocks = mockSsoOidcCommandModules();
    mocks.readOrganizationSsoOidcProvidersMock.mockResolvedValue(createSsoOidcProviderListResponse());
    const result: CliJsonResult<SsoOidcProviderListResponse> = await runCliJson(
      ['sso', 'oidc', 'list', '--output', 'json'],
      ssoOidcProviderListResponseSchema,
    );

    expectCliSuccess(result);
    expect(result.payload.providers).toHaveLength(2);
  });

  it('renders provider ids and keys in text list output', async (): Promise<void> => {
    const mocks: SsoOidcCommandMocks = mockSsoOidcCommandModules();
    mocks.readOrganizationSsoOidcProvidersMock.mockResolvedValue(createSsoOidcProviderListResponse());
    const capture: CliCommandCapture = createCliCapture();

    const result: CliCommandResult = await runCliCommand(['sso', 'oidc', 'list'], capture);

    expectCliSuccess(result);
    expect(readCliStdout(capture)).toContain('Display name\tKey\tId\tPreset\tIssuer URL');
    expect(readCliStdout(capture)).toContain('Google\tgoogle\tsop_google\tgoogle\thttps://accounts.google.com');
  });

  it('rejects invalid OIDC identity verification claim sources', async (): Promise<void> => {
    const mocks: SsoOidcCommandMocks = mockSsoOidcCommandModules();
    const capture: CliCommandCapture = createCliCapture();
    const result: CliCommandResult = await runCliCommand(
      [
        'sso',
        'oidc',
        'add',
        '--preset',
        'google',
        '--client-id',
        'client_123',
        '--client-secret',
        'secret_123',
        '--key',
        'google',
        '--email-claims',
        'access-token:email',
      ],
      capture,
    );

    expectCliFailure(result, 'Invalid OIDC claim reference "access-token:email"');
    expect(mocks.createOrganizationSsoOidcProviderMock).not.toHaveBeenCalled();
  });

  it('renders provider update output with parsed claim options', async (): Promise<void> => {
    const mocks: SsoOidcCommandMocks = mockSsoOidcCommandModules();
    mocks.updateOrganizationSsoOidcProviderMock.mockResolvedValue(
      createSsoOidcProviderResponse('sop_google', 'Google', 'google'),
    );
    const capture: CliCommandCapture = createCliCapture();
    const result: CliCommandResult = await runCliCommand(
      [
        'sso',
        'oidc',
        'update',
        'sop_google',
        '--email-claims',
        'id_token:email,userinfo:email',
        '--email-verified-claims',
        'userinfo:email_verified=true',
      ],
      capture,
    );

    expectCliSuccess(result);
    expect(readCliStdout(capture)).toContain('Updated OIDC SSO provider Google [google] (google).');
  });

  it('rejects empty provider updates', async (): Promise<void> => {
    const mocks: SsoOidcCommandMocks = mockSsoOidcCommandModules();
    const capture: CliCommandCapture = createCliCapture();
    const result: CliCommandResult = await runCliCommand(['sso', 'oidc', 'update', 'sop_google'], capture);

    expectCliFailure(result, 'Provide at least one OIDC provider option to update.');
    expect(mocks.updateOrganizationSsoOidcProviderMock).not.toHaveBeenCalled();
  });

  it('rejects enabled auto-join without a role', async (): Promise<void> => {
    const mocks: SsoOidcCommandMocks = mockSsoOidcCommandModules();
    const capture: CliCommandCapture = createCliCapture();
    const result: CliCommandResult = await runCliCommand(
      [
        'sso',
        'oidc',
        'add',
        '--preset',
        'google',
        '--client-id',
        'client_123',
        '--client-secret',
        'secret_123',
        '--key',
        'google',
        '--auto-join',
        'enabled',
        '--auto-join-domains',
        'example.com',
      ],
      capture,
    );

    expectCliFailure(result, 'OIDC auto-join requires --auto-join-role when enabled.');
    expect(mocks.createOrganizationSsoOidcProviderMock).not.toHaveBeenCalled();
  });

  it('emits the remove JSON contract', async (): Promise<void> => {
    const mocks: SsoOidcCommandMocks = mockSsoOidcCommandModules();
    mocks.deleteOrganizationSsoOidcProviderMock.mockResolvedValue({ success: true });
    const result: CliJsonResult<DeleteSsoOidcProviderResponse> = await runCliJson(
      ['sso', 'oidc', 'remove', 'sop_google', '--output', 'json'],
      deleteSsoOidcProviderResponseSchema,
    );

    expectCliSuccess(result);
    expect(result.payload.success).toBe(true);
  });
});

function createSsoOidcProviderListResponse(): SsoOidcProviderListResponse {
  return {
    providers: [
      createSsoOidcProviderResponse('sop_google', 'Google', 'google').provider!,
      createSsoOidcProviderResponse('sop_microsoft', 'Microsoft', 'microsoft').provider!,
    ],
  };
}

function createSsoOidcProviderResponse(providerId: string, displayName: string, key: string): SsoOidcProviderResponse {
  return {
    provider: {
      buttonText: `Login with ${displayName}`,
      clientId: 'client_123',
      createdAt: '2026-04-21T10:00:00.000Z',
      displayName,
      id: providerId,
      identityVerification: buildDefaultSsoOidcIdentityVerificationConfig(),
      issuerUrl: displayName === 'Google' ? 'https://accounts.google.com' : 'https://login.example.com',
      key,
      preset: displayName === 'Google' ? 'google' : 'generic',
      provisioning: buildDisabledSsoOidcProvisioningPolicy(),
      scope: 'openid email profile',
      updatedAt: '2026-04-21T10:00:00.000Z',
    },
  };
}

function mockSsoOidcCommandModules(): SsoOidcCommandMocks {
  const readCliConfigMock: Mock<ReadCliConfig> = vi.fn<ReadCliConfig>().mockResolvedValue(createCliConfigFixture());
  const createOrganizationSsoOidcProviderMock: Mock<CreateOrganizationSsoOidcProvider> =
    vi.fn<CreateOrganizationSsoOidcProvider>();
  const deleteOrganizationSsoOidcProviderMock: Mock<DeleteOrganizationSsoOidcProvider> =
    vi.fn<DeleteOrganizationSsoOidcProvider>();
  const readOrganizationSsoOidcProvidersMock: Mock<ReadOrganizationSsoOidcProviders> =
    vi.fn<ReadOrganizationSsoOidcProviders>();
  const updateOrganizationSsoOidcProviderMock: Mock<UpdateOrganizationSsoOidcProvider> =
    vi.fn<UpdateOrganizationSsoOidcProvider>();

  vi.doMock(
    '../src/services/sso-oidc-provider.service',
    (): SsoOidcProviderServiceModule => ({
      createOrganizationSsoOidcProvider: createOrganizationSsoOidcProviderMock,
      deleteOrganizationSsoOidcProvider: deleteOrganizationSsoOidcProviderMock,
      readOrganizationSsoOidcProviders: readOrganizationSsoOidcProvidersMock,
      updateOrganizationSsoOidcProvider: updateOrganizationSsoOidcProviderMock,
    }),
  );
  vi.doMock(
    '../src/store/config.store',
    (): ConfigStoreModule => ({
      readCliConfig: readCliConfigMock,
    }),
  );

  return {
    createOrganizationSsoOidcProviderMock,
    deleteOrganizationSsoOidcProviderMock,
    readCliConfigMock,
    readOrganizationSsoOidcProvidersMock,
    updateOrganizationSsoOidcProviderMock,
  };
}
