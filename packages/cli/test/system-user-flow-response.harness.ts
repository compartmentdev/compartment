import {
  type OrganizationSummary,
  type AuditEventType,
  type ProjectListResponse,
  type ProjectOverviewSummary,
  type SsoOidcProviderResponse,
  type SsoOidcProviderSummary,
} from '@compartment/contracts';
import { z } from 'zod';
import { organizationSummarySchema } from './remote-command-response.harness';

export interface OrganizationUseResponse {
  readonly organization: OrganizationSummary;
}

export const organizationUseResponseSchema: z.ZodType<OrganizationUseResponse> = z
  .object({
    organization: organizationSummarySchema,
  })
  .strict();

export const expectedAuditEventTypes: readonly AuditEventType[] = [
  'organization.user.invited',
  'organization.auth_settings.updated',
  'organization.settings.updated',
  'organization.role.created',
  'organization.role.updated',
  'organization.role.deleted',
  'organization.group.created',
  'organization.group.deleted',
  'organization.group.member_added',
  'organization.group.member_removed',
  'organization.assignment.created',
  'organization.assignment.deleted',
  'organization.sso_oidc_provider.created',
  'organization.sso_oidc_provider.updated',
  'organization.sso_oidc_provider.deleted',
  'organization.user.blocked',
  'organization.user.unblocked',
  'organization.user.removed',
];

export function requireProjectOverview(response: ProjectListResponse, projectName: string): ProjectOverviewSummary {
  if (response.detail !== 'overview') {
    throw new Error('Expected project list --full to return overview detail.');
  }

  const project: ProjectOverviewSummary | undefined = response.projects.find(
    (candidate: ProjectOverviewSummary): boolean => candidate.name === projectName,
  );
  if (project === undefined) {
    throw new Error(`Expected project ${projectName} in project list.`);
  }

  return project;
}

export function requireSsoProvider(response: SsoOidcProviderResponse): SsoOidcProviderSummary {
  if (response.provider === null) {
    throw new Error('Expected OIDC SSO provider response to include a provider.');
  }

  return response.provider;
}
