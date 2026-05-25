import type { JsonValue } from '@compartment/utils';
import type { LoaderFunctionArgs } from 'react-router';
import type { LoginStateResponse } from '@compartment/contracts/browser';
import type { BrowserProjectsPageResult } from '../src/services/browser-projects.service.types';
import type { BrowserGroupsPageResult } from '../src/services/browser-groups.service.types';
import type {
  BrowserDeploymentDetailsPageResult,
  BrowserDeploymentHistoryPageResult,
} from '../src/services/browser-deployment-history.service.types';
import type { BrowserAuditEventsPageResult } from '../src/services/browser-audit-events.service.types';
import type { BrowserProjectOverviewPageResult } from '../src/services/browser-project-overview.service.types';
import type { BrowserRolesPageResult } from '../src/services/browser-roles.service.types';
import type { BrowserUsersPageResult } from '../src/services/browser-users.service.types';

export interface BrowserApiErrorExpectation {
  message: string;
  name: 'BrowserApiError';
  status: number;
}
export interface LoginPageLoadResult {
  errorMessage?: string | undefined;
  initialEmail?: string | undefined;
  state: LoginStateResponse;
  successRedirectTo?: string | undefined;
}
export type BrowserGroupsPageLoadResult = BrowserGroupsPageResult | Response;
export type BrowserRolesPageLoadResult = BrowserRolesPageResult | Response;
export type BrowserUsersPageLoadResult = BrowserUsersPageResult | Response;
export type BrowserDeploymentHistoryPageLoadResult = BrowserDeploymentHistoryPageResult | Response;
export type BrowserDeploymentDetailsPageLoadResult = BrowserDeploymentDetailsPageResult | Response;
export type BrowserFetchCall = [input: string | URL | Request, init?: RequestInit | undefined];
export type FetchImplementation = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
type BrowserRedirectLoadResult =
  | BrowserGroupsPageLoadResult
  | BrowserRolesPageLoadResult
  | BrowserUsersPageLoadResult
  | BrowserDeploymentHistoryPageLoadResult
  | BrowserDeploymentDetailsPageLoadResult
  | BrowserAuditEventsPageResult
  | BrowserProjectOverviewPageResult
  | BrowserProjectsPageResult;
type TestRouteParams = Record<string, string>;

const consoleAdminPermissions: string[] = [
  'organization.user.read',
  'organization.user.invite',
  'organization.user.block',
  'organization.user.remove',
  'organization.user.credentials.reset',
  'organization.group.read',
  'organization.group.manage',
  'organization.role.read',
  'organization.role.manage',
];

export function createLoaderArgs(request: Request, params: TestRouteParams = {}): LoaderFunctionArgs {
  return {
    context: undefined,
    params,
    request,
    unstable_pattern: new URL(request.url).pathname,
    unstable_url: new URL(request.url),
  };
}

export function createConsoleAdminPermissions(): string[] {
  return [...consoleAdminPermissions];
}

export function createWhoamiResponse(
  currentOrganizationPermissions: string[] = createConsoleAdminPermissions(),
): JsonValue {
  return {
    currentOrganization: { id: 'org_123', name: 'Acme Dev', slug: 'acme-dev' },
    currentOrganizationPermissions,
    principal: { email: 'admin@example.com', id: 'prn_123', type: 'user' },
  };
}

export function createOrganizationListResponse(): JsonValue {
  return {
    organizations: [{ id: 'org_123', name: 'Acme Dev', slug: 'acme-dev' }],
  };
}

export function createDeploymentListResponse(): JsonValue {
  return {
    environment: { name: 'production' },
    deployments: [
      {
        completedAt: '2026-04-21T09:02:00.000Z',
        createdAt: '2026-04-21T09:00:00.000Z',
        deploymentRunId: 'drn_123',
        failureMessage: null,
        health: 'healthy',
        id: 'dep_123',
        isActive: true,
        label: 'release 42',
        operation: {
          completedAt: '2026-04-21T09:02:00.000Z',
          createdAt: '2026-04-21T09:00:00.000Z',
          status: 'succeeded',
          type: 'deployment.create',
        },
        promotionStage: 'active',
        rollbackAvailable: false,
        routeUrl: 'https://billing.apps.localhost',
        serviceName: 'web',
        status: 'succeeded',
      },
    ],
    project: { name: 'billing' },
  };
}

export function createProjectCountResponse(): JsonValue {
  return {
    detail: 'overview',
    pagination: {
      page: 1,
      perPage: 1,
      totalItems: 1,
      totalPages: 1,
    },
    projects: [],
  };
}

export function readFetchPath(input: string | URL | Request): string {
  if (typeof input === 'string') {
    return input;
  }
  if (input instanceof URL) {
    return input.toString();
  }

  return input.url;
}

export function requireRedirectResponse(result: BrowserRedirectLoadResult): Response {
  if (result instanceof Response) {
    return result;
  }

  throw new Error('Expected redirect response.');
}

export function noopBrowserNavigate(): void {
  return undefined;
}

export async function noopDeploymentHistoryRollback(): Promise<void> {
  return await Promise.resolve();
}
