import { sql, type SQL } from 'drizzle-orm';
import { gitProviderRegistrations } from '../db/schema';

export function buildGitProviderRegistrationOrganizationFilter(organizationId: string, registrationId?: string): SQL {
  return sql`position(${buildGitProviderRegistrationOrganizationPathFragment(
    organizationId,
    registrationId,
  )} in ${gitProviderRegistrations.webhookUrl}) > 0`;
}

export function readGitProviderRegistrationOrganizationId(webhookUrl: string): string | undefined {
  let pathname: string;
  try {
    pathname = new URL(webhookUrl).pathname;
  } catch {
    return undefined;
  }

  if (!pathname.startsWith(gitHubProviderRegistrationOrganizationPathPrefix)) {
    return undefined;
  }
  const pathParts: string[] = pathname.slice(gitHubProviderRegistrationOrganizationPathPrefix.length).split('/');
  const [organizationId, registrationsSegment, registrationId, webhookSegment, ...extraParts] = pathParts;
  if (
    organizationId === undefined ||
    organizationId.length === 0 ||
    registrationsSegment !== 'registrations' ||
    registrationId === undefined ||
    registrationId.length === 0 ||
    webhookSegment !== 'webhook' ||
    extraParts.length > 0
  ) {
    return undefined;
  }

  return organizationId;
}

function buildGitProviderRegistrationOrganizationPathFragment(organizationId: string, registrationId?: string): string {
  const registrationPath: string = registrationId === undefined ? '' : `${registrationId}/webhook`;
  return `${gitHubProviderRegistrationOrganizationPathPrefix}${organizationId}/registrations/${registrationPath}`;
}

const gitHubProviderRegistrationOrganizationPathPrefix: string = '/v1/sources/git/providers/github/organizations/';
