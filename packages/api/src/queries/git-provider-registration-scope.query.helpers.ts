import { sql, type SQL } from 'drizzle-orm';
import { gitProviderRegistrations } from '../db/schema';

export function buildGitProviderRegistrationOrganizationFilter(organizationId: string, registrationId?: string): SQL {
  return sql`position(${buildGitProviderRegistrationOrganizationPathFragment(
    organizationId,
    registrationId,
  )} in ${gitProviderRegistrations.webhookUrl}) > 0`;
}

export function readGitProviderRegistrationOrganizationId(webhookUrl: string): string | undefined {
  const pathname: string | undefined = readWebhookPathname(webhookUrl);
  if (pathname === undefined) return undefined;

  const prefixMatch: RegExpMatchArray | null = gitProviderRegistrationOrganizationPathPrefixPattern.exec(pathname);
  if (prefixMatch === null) {
    return undefined;
  }
  const pathParts: string[] = pathname.slice(prefixMatch[0].length).split('/');
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

function readWebhookPathname(webhookUrl: string): string | undefined {
  try {
    return new URL(webhookUrl).pathname;
  } catch {
    return undefined;
  }
}

function buildGitProviderRegistrationOrganizationPathFragment(organizationId: string, registrationId?: string): string {
  const registrationPath: string = registrationId === undefined ? '' : `${registrationId}/webhook`;
  return `/organizations/${organizationId}/registrations/${registrationPath}`;
}

const gitProviderRegistrationOrganizationPathPrefixPattern: RegExp =
  /^\/v1\/sources\/git\/providers\/[^/]+\/organizations\//;
