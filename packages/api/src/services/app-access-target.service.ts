import {
  compartmentAppCallbackPathname,
  type AppAccessBrowserFlowTarget,
  type AppAccessExchangeRequest,
} from '@compartment/contracts';
import { hasText, isSafeRelativePath } from '@compartment/utils';
import type { ApiConfig } from '../config';
import {
  createInvalidBrowserFlowError,
  createNotInstalledError,
  createRouteNotFoundError,
} from '../errors/api-business-error';
import { findActiveDeploymentRouteByHost } from '../queries/deployment-routes.query';
import type { DeploymentRouteLookupRow } from '../queries/deployment-routes.query.types';
import { hasCompletedInstallation } from '../queries/install.query';
import { getApiConfig } from '../runtime/runtime-access';
import { buildPublicRouteUrl } from './public-hosts.service';

export async function requireKnownBrowserFlowTarget(
  input: AppAccessBrowserFlowTarget,
): Promise<AppAccessBrowserFlowTarget> {
  assertValidFlowPath(input.path, input.state);
  await assertKnownCompartmentHost(input.host);

  return input;
}

export async function requireExchangeFlowTarget(input: AppAccessExchangeRequest): Promise<AppAccessExchangeRequest> {
  if (!hasText(input.state)) {
    throw createInvalidBrowserFlowError();
  }
  await assertKnownCompartmentHost(input.host);

  return input;
}

export function buildAppCallbackUrl(host: string, code: string, state: string): string {
  const config: ApiConfig = getApiConfig();
  const url: URL = new URL(
    compartmentAppCallbackPathname,
    `${buildPublicRouteUrl(
      {
        host,
      },
      config,
    )}/`,
  );
  url.searchParams.set('code', code);
  url.searchParams.set('state', state);

  return url.toString();
}

function assertValidFlowPath(path: string, state: string): void {
  if (!isSafeRelativePath(path) || !hasText(state)) {
    throw createInvalidBrowserFlowError();
  }
}

async function assertKnownCompartmentHost(host: string): Promise<void> {
  const config: ApiConfig = getApiConfig();
  const route: DeploymentRouteLookupRow | undefined = await findActiveDeploymentRouteByHost(host, config.baseDomain);
  if (route === undefined) {
    throw createRouteNotFoundError();
  }
}

export async function requireInstalledCompartment(): Promise<void> {
  if (!(await hasCompletedInstallation())) {
    throw createNotInstalledError();
  }
}
