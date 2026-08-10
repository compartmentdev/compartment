import type { AppAccessBrowserFlowTarget } from '@compartment/contracts';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { findActiveDeploymentRouteByHost } from '../src/queries/deployment-routes.query';
import type { DeploymentRouteLookupRow } from '../src/queries/deployment-routes.query.types';
import type {
  countOrganizations,
  listOrganizationRows,
  listOrganizationRowsForPrincipalEmail,
} from '../src/queries/organizations.query';
import type { OrganizationRow } from '../src/queries/organizations.query.types';
import type { getApiConfig } from '../src/runtime/runtime-access';
import type { readOrganizationAuthSettings } from '../src/services/organization-auth-settings.service';
import {
  discoverBrowserLoginState,
  readInitialBrowserLoginState,
  readTrustedInitialBrowserLoginState,
} from '../src/services/browser-login-flow.service';
import type { BrowserLoginFlowState } from '../src/services/browser-login-flow.service.types';
import type { listBrowserSsoProviderOptionsForOrganization } from '../src/services/sso-oidc/sso-oidc-provider.service';
import type { BrowserSsoProviderOption } from '../src/services/sso-oidc/sso-oidc.service.types';
import { createBrowserFlowTarget } from './browser-test.fixtures';
import { createApiTestConfig } from './api-config-test.fixtures';

type CountOrganizations = typeof countOrganizations;
type FindActiveDeploymentRouteByHost = typeof findActiveDeploymentRouteByHost;
type GetApiConfig = typeof getApiConfig;
type ListBrowserSsoProviderOptionsForOrganization = typeof listBrowserSsoProviderOptionsForOrganization;
type ListOrganizationRows = typeof listOrganizationRows;
type ListOrganizationRowsForPrincipalEmail = typeof listOrganizationRowsForPrincipalEmail;
type ReadOrganizationAuthSettings = typeof readOrganizationAuthSettings;

interface BrowserLoginFlowServiceMocks {
  countOrganizations: Mock<CountOrganizations>;
  findActiveDeploymentRouteByHost: Mock<FindActiveDeploymentRouteByHost>;
  getApiConfig: Mock<GetApiConfig>;
  listBrowserSsoProviderOptionsForOrganization: Mock<ListBrowserSsoProviderOptionsForOrganization>;
  listOrganizationRows: Mock<ListOrganizationRows>;
  listOrganizationRowsForPrincipalEmail: Mock<ListOrganizationRowsForPrincipalEmail>;
  readOrganizationAuthSettings: Mock<ReadOrganizationAuthSettings>;
}

const mocks: BrowserLoginFlowServiceMocks = vi.hoisted(
  (): BrowserLoginFlowServiceMocks => ({
    countOrganizations: vi.fn<CountOrganizations>(),
    findActiveDeploymentRouteByHost: vi.fn<FindActiveDeploymentRouteByHost>(),
    getApiConfig: vi.fn<GetApiConfig>(),
    listBrowserSsoProviderOptionsForOrganization: vi.fn<ListBrowserSsoProviderOptionsForOrganization>(),
    listOrganizationRows: vi.fn<ListOrganizationRows>(),
    listOrganizationRowsForPrincipalEmail: vi.fn<ListOrganizationRowsForPrincipalEmail>(),
    readOrganizationAuthSettings: vi.fn<ReadOrganizationAuthSettings>(),
  }),
);

vi.mock(
  '../src/queries/organizations.query',
  (): {
    countOrganizations: Mock<CountOrganizations>;
    listOrganizationRows: Mock<ListOrganizationRows>;
    listOrganizationRowsForPrincipalEmail: Mock<ListOrganizationRowsForPrincipalEmail>;
  } => ({
    countOrganizations: mocks.countOrganizations,
    listOrganizationRows: mocks.listOrganizationRows,
    listOrganizationRowsForPrincipalEmail: mocks.listOrganizationRowsForPrincipalEmail,
  }),
);

vi.mock(
  '../src/queries/deployment-routes.query',
  (): { findActiveDeploymentRouteByHost: Mock<FindActiveDeploymentRouteByHost> } => ({
    findActiveDeploymentRouteByHost: mocks.findActiveDeploymentRouteByHost,
  }),
);

vi.mock('../src/runtime/runtime-access', (): { getApiConfig: Mock<GetApiConfig> } => ({
  getApiConfig: mocks.getApiConfig,
}));

vi.mock(
  '../src/services/organization-auth-settings.service',
  (): { readOrganizationAuthSettings: Mock<ReadOrganizationAuthSettings> } => ({
    readOrganizationAuthSettings: mocks.readOrganizationAuthSettings,
  }),
);

vi.mock(
  '../src/services/sso-oidc/sso-oidc-provider.service',
  (): {
    listBrowserSsoProviderOptionsForOrganization: Mock<ListBrowserSsoProviderOptionsForOrganization>;
  } => ({
    listBrowserSsoProviderOptionsForOrganization: mocks.listBrowserSsoProviderOptionsForOrganization,
  }),
);

describe('browser login flow service', (): void => {
  beforeEach((): void => {
    Object.values(mocks).forEach((mock: Mock): void => {
      mock.mockReset();
    });
    mocks.getApiConfig.mockReturnValue(createApiTestConfig());
    mocks.readOrganizationAuthSettings.mockResolvedValue({ localPasswordEnabled: false });
    mocks.listBrowserSsoProviderOptionsForOrganization.mockImplementation(readSsoOptions);
  });

  it('auto-redirects single-org email discovery to SSO with the app flow target', async (): Promise<void> => {
    mocks.listOrganizationRowsForPrincipalEmail.mockResolvedValueOnce([createOrganization()]);

    const state: BrowserLoginFlowState = await discoverBrowserLoginState({
      email: 'admin@example.com',
      flowTarget: createBrowserFlowTarget(),
    });

    expect(state).toEqual({
      kind: 'redirect',
      redirectUrl: '/login/sso?provider=sop_123&host=billing.apps.localhost&path=%2Fdashboard&state=flow',
    });
    expect(mocks.listBrowserSsoProviderOptionsForOrganization).toHaveBeenCalledWith(
      'org_123',
      createBrowserFlowTarget(),
    );
  });

  it('keeps app-targeted initial browser login auto-redirect unchanged', async (): Promise<void> => {
    mocks.findActiveDeploymentRouteByHost.mockResolvedValueOnce(createDeploymentRouteLookupRow());

    const state: BrowserLoginFlowState = await readInitialBrowserLoginState(createBrowserFlowTarget());

    expect(state).toEqual({
      kind: 'redirect',
      redirectUrl: '/login/sso?provider=sop_123&host=billing.apps.localhost&path=%2Fdashboard&state=flow',
    });
    expect(mocks.countOrganizations).not.toHaveBeenCalled();
    expect(mocks.listOrganizationRows).not.toHaveBeenCalled();
    expect(mocks.listBrowserSsoProviderOptionsForOrganization).toHaveBeenCalledWith(
      'org_123',
      createBrowserFlowTarget(),
    );
  });

  it('starts bare multi-org browser login with email entry', async (): Promise<void> => {
    mocks.countOrganizations.mockResolvedValueOnce(2);

    const state: BrowserLoginFlowState = await readInitialBrowserLoginState(null);

    expect(state).toEqual({
      flowTarget: null,
      kind: 'email_entry',
    });
    expect(mocks.countOrganizations).toHaveBeenCalledOnce();
    expect(mocks.listOrganizationRows).not.toHaveBeenCalled();
    expect(mocks.listBrowserSsoProviderOptionsForOrganization).not.toHaveBeenCalled();
  });

  it('shows bare single-org browser login methods without auto-redirect', async (): Promise<void> => {
    mocks.countOrganizations.mockResolvedValueOnce(1);
    mocks.listOrganizationRows.mockResolvedValueOnce([createOrganization()]);

    const state: BrowserLoginFlowState = await readInitialBrowserLoginState(null);

    expect(state).toEqual({
      flowTarget: null,
      kind: 'methods',
      localPasswordEnabled: false,
      organizationSlug: 'acme-dev',
      ssoOptions: [createSsoOption(null)],
    });
    expect(mocks.countOrganizations).toHaveBeenCalledOnce();
    expect(mocks.listOrganizationRows).toHaveBeenCalledOnce();
    expect(mocks.listBrowserSsoProviderOptionsForOrganization).toHaveBeenCalledWith('org_123', null);
  });

  it('keeps trusted single-org browser login state aligned with bare login methods', async (): Promise<void> => {
    mocks.countOrganizations.mockResolvedValueOnce(1);
    mocks.listOrganizationRows.mockResolvedValueOnce([createOrganization()]);

    const state: BrowserLoginFlowState = await readTrustedInitialBrowserLoginState(null);

    expect(state).toEqual({
      flowTarget: null,
      kind: 'methods',
      localPasswordEnabled: false,
      organizationSlug: 'acme-dev',
      ssoOptions: [createSsoOption(null)],
    });
    expect(mocks.countOrganizations).toHaveBeenCalledOnce();
    expect(mocks.listOrganizationRows).toHaveBeenCalledOnce();
    expect(mocks.listBrowserSsoProviderOptionsForOrganization).toHaveBeenCalledWith('org_123', null);
  });

  it('auto-redirects selected-org email discovery to SSO with the app flow target', async (): Promise<void> => {
    mocks.listOrganizationRowsForPrincipalEmail.mockResolvedValueOnce([
      createOrganization(),
      createOrganization({ id: 'org_456', name: 'Beta Dev', slug: 'beta-dev' }),
    ]);

    const state: BrowserLoginFlowState = await discoverBrowserLoginState({
      email: 'admin@example.com',
      flowTarget: createBrowserFlowTarget(),
      organizationSlug: 'beta-dev',
    });

    expect(state).toEqual({
      kind: 'redirect',
      redirectUrl: '/login/sso?provider=sop_123&host=billing.apps.localhost&path=%2Fdashboard&state=flow',
    });
    expect(mocks.listOrganizationRowsForPrincipalEmail).toHaveBeenCalledWith('admin@example.com');
    expect(mocks.listOrganizationRows).not.toHaveBeenCalled();
    expect(mocks.listBrowserSsoProviderOptionsForOrganization).toHaveBeenCalledWith(
      'org_456',
      createBrowserFlowTarget(),
    );
  });

  it('rejects selected-org email discovery when the email cannot see the organization', async (): Promise<void> => {
    mocks.listOrganizationRowsForPrincipalEmail.mockResolvedValueOnce([createOrganization()]);

    await expect(
      discoverBrowserLoginState({
        email: 'first.login@example.com',
        flowTarget: createBrowserFlowTarget(),
        organizationSlug: 'beta-dev',
      }),
    ).rejects.toMatchObject({ code: 'invalid_credentials' });

    expect(mocks.listOrganizationRowsForPrincipalEmail).toHaveBeenCalledWith('first.login@example.com');
    expect(mocks.listOrganizationRows).not.toHaveBeenCalled();
    expect(mocks.listBrowserSsoProviderOptionsForOrganization).not.toHaveBeenCalled();
  });

  it('keeps trusted preselected organization discovery without an email', async (): Promise<void> => {
    mocks.listOrganizationRows.mockResolvedValueOnce([
      createOrganization(),
      createOrganization({ id: 'org_456', name: 'Beta Dev', slug: 'beta-dev' }),
    ]);

    const state: BrowserLoginFlowState = await discoverBrowserLoginState({
      flowTarget: createBrowserFlowTarget(),
      organizationSlug: 'beta-dev',
    });

    expect(state).toEqual({
      kind: 'redirect',
      redirectUrl: '/login/sso?provider=sop_123&host=billing.apps.localhost&path=%2Fdashboard&state=flow',
    });
    expect(mocks.listOrganizationRowsForPrincipalEmail).not.toHaveBeenCalled();
    expect(mocks.listBrowserSsoProviderOptionsForOrganization).toHaveBeenCalledWith(
      'org_456',
      createBrowserFlowTarget(),
    );
  });
});

async function readSsoOptions(
  _organizationId: string,
  flowTarget: AppAccessBrowserFlowTarget | null,
): Promise<BrowserSsoProviderOption[]> {
  const options: BrowserSsoProviderOption[] = await Promise.resolve([createSsoOption(flowTarget)]);

  return options;
}

function createOrganization(input: Partial<OrganizationRow> = {}): OrganizationRow {
  return {
    id: input.id ?? 'org_123',
    name: input.name ?? 'Acme Dev',
    slug: input.slug ?? 'acme-dev',
  };
}

function createDeploymentRouteLookupRow(input: Partial<DeploymentRouteLookupRow> = {}): DeploymentRouteLookupRow {
  return {
    accessMode: input.accessMode ?? 'authenticated',
    accessScopeId: input.accessScopeId ?? 'env_123',
    accessScopeType: input.accessScopeType ?? 'environment',
    deploymentId: input.deploymentId ?? 'dep_123',
    environmentId: input.environmentId ?? 'env_123',
    environmentName: input.environmentName ?? 'production',
    host: input.host ?? 'billing.apps.localhost',
    organizationId: input.organizationId ?? 'org_123',
    organizationSlug: input.organizationSlug ?? 'acme-dev',
    projectId: input.projectId ?? 'prj_123',
    projectName: input.projectName ?? 'billing',
    resolvedRoutesJson: input.resolvedRoutesJson ?? '[]',
    serviceId: input.serviceId ?? 'svc_123',
    serviceName: input.serviceName ?? 'web',
    upstreamHost: input.upstreamHost ?? null,
    upstreamPort: input.upstreamPort ?? 3000,
  };
}

function createSsoOption(flowTarget: AppAccessBrowserFlowTarget | null): BrowserSsoProviderOption {
  return {
    buttonText: 'Login with Google',
    displayName: 'Google',
    loginUrl: buildSsoLoginUrl(flowTarget),
    providerId: 'sop_123',
    preset: 'google',
  };
}

function buildSsoLoginUrl(flowTarget: AppAccessBrowserFlowTarget | null): string {
  const params: URLSearchParams = new URLSearchParams({ provider: 'sop_123' });
  if (flowTarget !== null) {
    params.set('host', flowTarget.host);
    params.set('path', flowTarget.path);
    params.set('state', flowTarget.state);
  }

  return `/login/sso?${params.toString()}`;
}
