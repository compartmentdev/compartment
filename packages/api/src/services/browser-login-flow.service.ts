import type { AppAccessBrowserFlowTarget } from '@compartment/contracts';
import { createInvalidCredentialsError } from '../errors/api-business-error';
import { findActiveDeploymentRouteByHost } from '../queries/deployment-routes.query';
import type { DeploymentRouteLookupRow } from '../queries/deployment-routes.query.types';
import {
  countOrganizations,
  listOrganizationRows,
  listOrganizationRowsForPrincipalEmail,
} from '../queries/organizations.query';
import type { OrganizationRow } from '../queries/organizations.query.types';
import { getApiConfig } from '../runtime/runtime-access';
import { readOrganizationAuthSettings } from './organization-auth-settings.service';
import { requireMatchingOrganizationRow } from './organization-row-match.service.helpers';
import { listBrowserSsoProviderOptionsForOrganization } from './sso-oidc/sso-oidc-provider.service';
import type {
  BrowserLoginDiscoveryInput,
  BrowserLoginFlowState,
  BrowserLoginMethodsState,
} from './browser-login-flow.service.types';
import type { BrowserSsoProviderOption } from './sso-oidc/sso-oidc.service.types';

interface OrganizationBrowserLoginStateInput {
  allowAutoRedirect: boolean;
  email?: string | undefined;
  flowTarget: AppAccessBrowserFlowTarget | null;
  organizationId: string;
  organizationSlug: string;
}

interface EmailBrowserLoginDiscoveryInput extends BrowserLoginDiscoveryInput {
  email: string;
}

export async function discoverBrowserLoginState(
  input: BrowserLoginDiscoveryInput,
  allowAutoRedirect: boolean = true,
): Promise<BrowserLoginFlowState> {
  if (hasBrowserLoginDiscoveryEmail(input)) {
    return await readEmailDiscoveredBrowserLoginState(input, allowAutoRedirect);
  }

  return await readEmaillessBrowserLoginState(input, allowAutoRedirect);
}

async function readEmailDiscoveredBrowserLoginState(
  input: EmailBrowserLoginDiscoveryInput,
  allowAutoRedirect: boolean,
): Promise<BrowserLoginFlowState> {
  const organizations: OrganizationRow[] = await listOrganizationRowsForPrincipalEmail(input.email);
  if (organizations.length === 0) {
    throw createInvalidCredentialsError();
  }
  if (input.organizationSlug !== undefined) {
    return await readSingleDiscoveredOrganizationState(
      input,
      requireMatchingOrganizationRow(organizations, input.organizationSlug),
      allowAutoRedirect,
    );
  }
  if (organizations.length === 1) {
    return await readSingleDiscoveredOrganizationState(input, organizations[0]!, allowAutoRedirect);
  }

  return buildOrganizationSelectionState(input.email, input.flowTarget, organizations);
}

async function readEmaillessBrowserLoginState(
  input: BrowserLoginDiscoveryInput,
  allowAutoRedirect: boolean,
): Promise<BrowserLoginFlowState> {
  if (input.organizationSlug !== undefined) {
    return await readTrustedPreselectedOrganizationState(input.flowTarget, input.organizationSlug, allowAutoRedirect);
  }

  return await readInitialBrowserLoginState(input.flowTarget, allowAutoRedirect);
}

function hasBrowserLoginDiscoveryEmail(input: BrowserLoginDiscoveryInput): input is EmailBrowserLoginDiscoveryInput {
  return input.email !== undefined;
}

export async function resolveBrowserLoginOrganizationId(
  flowTarget: AppAccessBrowserFlowTarget | null,
  organizationSlug: string | undefined,
): Promise<string> {
  if (flowTarget !== null) {
    return await resolveBrowserLoginOrganizationIdForFlowTarget(flowTarget);
  }

  return await resolveBareBrowserLoginOrganizationId(organizationSlug);
}

export async function readTrustedInitialBrowserLoginState(
  flowTarget: AppAccessBrowserFlowTarget | null,
  allowAutoRedirect: boolean = true,
): Promise<BrowserLoginFlowState> {
  return await readInitialBrowserLoginState(flowTarget, allowAutoRedirect);
}

export async function readInitialBrowserLoginState(
  flowTarget: AppAccessBrowserFlowTarget | null,
  allowAutoRedirect: boolean = true,
): Promise<BrowserLoginFlowState> {
  if (flowTarget !== null) {
    return await readFlowTargetBrowserLoginState(flowTarget, allowAutoRedirect);
  }

  return await readBareBrowserLoginState();
}

async function readFlowTargetBrowserLoginState(
  flowTarget: AppAccessBrowserFlowTarget,
  allowAutoRedirect: boolean,
): Promise<BrowserLoginFlowState> {
  const route: DeploymentRouteLookupRow | undefined = await findBrowserLoginFlowTargetRoute(flowTarget);
  if (route === undefined) {
    return buildBrowserLoginMethodsState(flowTarget, undefined, undefined, [], true);
  }

  return await buildOrganizationBrowserLoginState({
    allowAutoRedirect,
    email: undefined,
    flowTarget,
    organizationId: route.organizationId,
    organizationSlug: route.organizationSlug,
  });
}

async function readBareBrowserLoginState(): Promise<BrowserLoginFlowState> {
  if ((await countOrganizations()) !== 1) {
    return buildBareBrowserLoginEmailEntryState();
  }

  const organization: OrganizationRow = await requireSingleOrganization();

  return await buildOrganizationBrowserLoginState({
    allowAutoRedirect: false,
    email: undefined,
    flowTarget: null,
    organizationId: organization.id,
    organizationSlug: organization.slug,
  });
}

function buildBareBrowserLoginEmailEntryState(): BrowserLoginFlowState {
  return {
    flowTarget: null,
    kind: 'email_entry',
  };
}

async function readTrustedPreselectedOrganizationState(
  flowTarget: AppAccessBrowserFlowTarget | null,
  organizationSlug: string,
  allowAutoRedirect: boolean,
): Promise<BrowserLoginFlowState> {
  const organization: OrganizationRow = requireMatchingOrganizationRow(await listOrganizationRows(), organizationSlug);

  return await buildOrganizationBrowserLoginState({
    allowAutoRedirect,
    email: undefined,
    flowTarget,
    organizationId: organization.id,
    organizationSlug: organization.slug,
  });
}

async function readSingleDiscoveredOrganizationState(
  input: BrowserLoginDiscoveryInput,
  organization: OrganizationRow,
  allowAutoRedirect: boolean,
): Promise<BrowserLoginFlowState> {
  return await buildOrganizationBrowserLoginState({
    allowAutoRedirect,
    email: input.email,
    flowTarget: input.flowTarget,
    organizationId: organization.id,
    organizationSlug: organization.slug,
  });
}

async function resolveBrowserLoginOrganizationIdForFlowTarget(flowTarget: AppAccessBrowserFlowTarget): Promise<string> {
  const route: DeploymentRouteLookupRow | undefined = await findBrowserLoginFlowTargetRoute(flowTarget);
  if (route === undefined) {
    throw createInvalidCredentialsError();
  }

  return route.organizationId;
}

async function findBrowserLoginFlowTargetRoute(
  flowTarget: AppAccessBrowserFlowTarget,
): Promise<DeploymentRouteLookupRow | undefined> {
  return await findActiveDeploymentRouteByHost(flowTarget.host, getApiConfig().baseDomain);
}

async function resolveBareBrowserLoginOrganizationId(organizationSlug: string | undefined): Promise<string> {
  const organizations: OrganizationRow[] = await listOrganizationRows();
  if (organizations.length === 1) {
    return organizations[0]!.id;
  }
  if (organizationSlug === undefined) {
    throw createInvalidCredentialsError();
  }

  return requireMatchingOrganizationRow(organizations, organizationSlug).id;
}

async function requireSingleOrganization(): Promise<OrganizationRow> {
  const [organization]: OrganizationRow[] = await listOrganizationRows();
  if (organization === undefined) {
    throw new Error('Expected a single organization to exist.');
  }

  return organization;
}

function buildOrganizationSelectionState(
  email: string,
  flowTarget: AppAccessBrowserFlowTarget | null,
  organizations: OrganizationRow[],
): BrowserLoginFlowState {
  return {
    email,
    flowTarget,
    kind: 'organization_selection',
    organizations,
  };
}

async function buildOrganizationBrowserLoginState(
  input: OrganizationBrowserLoginStateInput,
): Promise<BrowserLoginFlowState> {
  const localPasswordEnabled: boolean = (await readOrganizationAuthSettings(input.organizationId)).localPasswordEnabled;
  const ssoOptions: BrowserSsoProviderOption[] = await listBrowserSsoProviderOptionsForOrganization(
    input.organizationId,
    input.flowTarget,
  );
  if (input.allowAutoRedirect && !localPasswordEnabled && ssoOptions.length === 1) {
    return {
      kind: 'redirect',
      redirectUrl: ssoOptions[0]!.loginUrl,
    };
  }

  return buildBrowserLoginMethodsState(
    input.flowTarget,
    input.email,
    input.organizationSlug,
    ssoOptions,
    localPasswordEnabled,
  );
}

function buildBrowserLoginMethodsState(
  flowTarget: AppAccessBrowserFlowTarget | null,
  email: string | undefined,
  organizationSlug: string | undefined,
  ssoOptions: BrowserSsoProviderOption[],
  localPasswordEnabled: boolean,
): BrowserLoginMethodsState {
  return {
    ...(email !== undefined ? { email } : {}),
    flowTarget,
    kind: 'methods',
    localPasswordEnabled,
    ...(organizationSlug !== undefined ? { organizationSlug } : {}),
    ssoOptions,
  };
}
