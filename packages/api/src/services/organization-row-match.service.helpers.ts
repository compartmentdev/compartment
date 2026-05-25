import { createInvalidCredentialsError } from '../errors/api-business-error';
import type { OrganizationRow } from '../queries/organizations.query.types';

export function requireMatchingOrganizationRow(
  organizations: OrganizationRow[],
  organizationSlug: string,
): OrganizationRow {
  const organization: OrganizationRow | undefined = organizations.find(
    (candidate: OrganizationRow): boolean => candidate.slug === organizationSlug,
  );
  if (organization === undefined) {
    throw createInvalidCredentialsError();
  }

  return organization;
}
