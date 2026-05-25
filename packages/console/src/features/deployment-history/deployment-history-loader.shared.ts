import {
  readBrowserErrorMessage,
  loadBrowserConsoleContext,
  type BrowserConsoleContext,
} from '../console/console-data';
import { requestBrowserApi } from '../../lib/browser-api';
import { readBrowserApiRedirect } from '../../lib/browser-redirect';
import { readTrimmedSearchParam } from '../../lib/server-table-query';
import { buildProjectOverviewHref } from '../projects/project-overview-query';
import type { ZodType } from 'zod';

export interface DeploymentHistoryLocationQuery {
  environmentName: string | null;
}

export async function fetchDeploymentHistoryApi<TResult>(
  path: string,
  schema: ZodType<TResult>,
  currentOrganization: string,
): Promise<TResult> {
  try {
    return await requestBrowserApi<TResult>(path, schema, {
      currentOrganization,
    });
  } catch (error) {
    if (error instanceof Error) {
      throwDeploymentHistoryApiRedirect(error);
    }

    throw error;
  }
}

export async function loadDeploymentHistoryConsoleContext(url: URL): Promise<BrowserConsoleContext> {
  return await loadBrowserConsoleContext(url, {}, { allowLegacyOrganizationQuery: false });
}

export function readDeploymentHistoryErrorMessage(searchParams: URLSearchParams): string | undefined {
  return readBrowserErrorMessage(searchParams.get('error'));
}

export function readDeploymentHistoryLocationQuery(searchParams: URLSearchParams): DeploymentHistoryLocationQuery {
  return {
    environmentName: readNullableTrimmedSearchParam(searchParams, 'environmentName'),
  };
}

function readNullableTrimmedSearchParam(searchParams: URLSearchParams, key: string): string | null {
  const value: string = readTrimmedSearchParam(searchParams, key);
  return value === '' ? null : value;
}

export function readRequiredRouteParam(value: string | undefined, name: string): string {
  if (value === undefined || value === '') {
    throw new Error(`Expected ${name} route parameter.`);
  }

  return value;
}

export function buildProjectOverviewEnvironmentRequiredHref(
  projectName: string,
  organizationSlug: string | null,
): string {
  const overviewHref: string = buildProjectOverviewHref({
    environmentName: null,
    organizationSlug,
    projectName,
  });

  return `${overviewHref}${overviewHref.includes('?') ? '&' : '?'}error=project_overview_environment_required`;
}

export function throwDeploymentHistoryApiRedirect(error: Error): never {
  const apiRedirect: Error | null = readBrowserApiRedirect(error);
  if (apiRedirect !== null) {
    throw apiRedirect;
  }

  throw error;
}
