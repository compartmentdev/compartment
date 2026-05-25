import type { AppAccessBrowserFlowTarget } from '@compartment/contracts';
import { hasText } from '@compartment/utils';
import { createInvalidSsoLoginError } from '../../errors/api-business-error';
import { findActiveDeploymentRouteByHost } from '../../queries/deployment-routes.query';
import type { DeploymentRouteLookupRow } from '../../queries/deployment-routes.query.types';
import { findSsoOidcProviderById, listSsoOidcProvidersByOrganization } from '../../queries/sso-oidc.query';
import type { SsoOidcFlowRow, SsoOidcProviderRow } from '../../queries/sso-oidc.query.types';
import { getApiConfig } from '../../runtime/runtime-access';
import { requireKnownBrowserFlowTarget } from '../app-access-target.service';
import type { BrowserSsoFlowTarget, StartBrowserSsoLoginInput } from './sso-oidc.service.types';

interface ResolvedBrowserSsoStartInput {
  flowTarget: BrowserSsoFlowTarget;
  provider: SsoOidcProviderRow;
}

export async function resolveBrowserSsoStartInput(
  input: StartBrowserSsoLoginInput,
): Promise<ResolvedBrowserSsoStartInput> {
  const flowTarget: BrowserSsoFlowTarget =
    input.flowTarget === null ? null : await requireKnownBrowserFlowTarget(input.flowTarget);

  return {
    flowTarget,
    provider: await resolveStartSsoProvider(flowTarget, input.providerId),
  };
}

export async function requireSsoOidcProviderById(providerId: string): Promise<SsoOidcProviderRow> {
  return await requireSsoOidcProvider(providerId);
}

export function readSsoOidcFlowTarget(flow: SsoOidcFlowRow): BrowserSsoFlowTarget {
  if (flow.flowHost === null && flow.flowPath === null && flow.flowState === null) {
    return null;
  }
  if (flow.flowHost === null || flow.flowPath === null || flow.flowState === null) {
    throw createInvalidSsoLoginError();
  }

  return {
    host: flow.flowHost,
    path: flow.flowPath,
    state: flow.flowState,
  };
}

async function resolveStartSsoProvider(
  flowTarget: BrowserSsoFlowTarget,
  providerId: string | undefined,
): Promise<SsoOidcProviderRow> {
  if (flowTarget === null) {
    return await resolveBareStartSsoProvider(providerId);
  }

  return await resolveFlowTargetStartSsoProvider(flowTarget, providerId);
}

async function resolveBareStartSsoProvider(providerId: string | undefined): Promise<SsoOidcProviderRow> {
  if (!hasText(providerId)) {
    throw createInvalidSsoLoginError();
  }

  return await requireSsoOidcProvider(providerId);
}

async function resolveFlowTargetStartSsoProvider(
  flowTarget: AppAccessBrowserFlowTarget,
  providerId: string | undefined,
): Promise<SsoOidcProviderRow> {
  const route: DeploymentRouteLookupRow = await requireActiveDeploymentRoute(flowTarget.host);
  const providers: SsoOidcProviderRow[] = await listSsoOidcProvidersByOrganization(route.organizationId);
  if (providers.length === 0) {
    throw createInvalidSsoLoginError();
  }
  if (hasText(providerId)) {
    return requireRequestedOrganizationProvider(providers, providerId);
  }

  return requireSingleOrganizationProvider(providers);
}

async function requireActiveDeploymentRoute(host: string): Promise<DeploymentRouteLookupRow> {
  const route: DeploymentRouteLookupRow | undefined = await findActiveDeploymentRouteByHost(
    host,
    getApiConfig().baseDomain,
  );
  if (route === undefined) {
    throw createInvalidSsoLoginError();
  }

  return route;
}

async function requireSsoOidcProvider(providerId: string): Promise<SsoOidcProviderRow> {
  const provider: SsoOidcProviderRow | undefined = await findSsoOidcProviderById(providerId);
  if (provider === undefined) {
    throw createInvalidSsoLoginError();
  }

  return provider;
}

function requireRequestedOrganizationProvider(providers: SsoOidcProviderRow[], providerId: string): SsoOidcProviderRow {
  const provider: SsoOidcProviderRow | undefined = providers.find(
    (candidate: SsoOidcProviderRow): boolean => candidate.id === providerId,
  );
  if (provider === undefined) {
    throw createInvalidSsoLoginError();
  }

  return provider;
}

function requireSingleOrganizationProvider(providers: SsoOidcProviderRow[]): SsoOidcProviderRow {
  if (providers.length !== 1) {
    throw createInvalidSsoLoginError();
  }

  return providers[0]!;
}
