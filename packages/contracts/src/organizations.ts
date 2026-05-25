import type { OrganizationSummary } from './contracts/organizations.contract';

export function findOrganizationBySlug(
  organizations: OrganizationSummary[],
  requestedOrganizationSlug: string,
): OrganizationSummary | null {
  return (
    organizations.find(
      (organization: OrganizationSummary): boolean => organization.slug === requestedOrganizationSlug,
    ) ?? null
  );
}
