import {
  findOrganizationRowForPrincipalBySlug,
  listOrganizationRowsForPrincipal,
} from '../queries/organizations.query';
import { isAuthSessionPolicyAllowedForOrganization } from './organization-auth-settings.service';
import type { AuthSessionOrganizationPolicySession } from './organization-auth-settings.service.types';
import type { ResolvedOrganization, SessionVisibleOrganizationInput } from './organizations.service.types';

export async function listSessionVisibleOrganizations(
  session: AuthSessionOrganizationPolicySession,
): Promise<ResolvedOrganization[]> {
  return await filterSessionVisibleOrganizations(await listOrganizationsForPrincipal(session.principalId), session);
}

async function listOrganizationsForPrincipal(principalId: string): Promise<ResolvedOrganization[]> {
  return await listOrganizationRowsForPrincipal(principalId);
}

export async function filterSessionVisibleOrganizations<TOrganization extends SessionVisibleOrganizationInput>(
  organizations: TOrganization[],
  session: AuthSessionOrganizationPolicySession,
): Promise<TOrganization[]> {
  const visibility: boolean[] = await Promise.all(
    organizations.map(
      async (organization: TOrganization): Promise<boolean> =>
        await isAuthSessionPolicyAllowedForOrganization({
          organizationId: organization.id,
          session,
        }),
    ),
  );

  return organizations.filter((_organization: TOrganization, index: number): boolean => visibility[index] === true);
}

export async function resolveOrganizationForPrincipal(
  principalId: string,
  organizationSlug: string,
): Promise<ResolvedOrganization | undefined> {
  return await findOrganizationRowForPrincipalBySlug(principalId, organizationSlug);
}
