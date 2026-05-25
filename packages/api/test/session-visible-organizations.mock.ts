import type { Mock } from 'vitest';
import type { AuthSessionOrganizationPolicySession } from '../src/services/organization-auth-settings.service.types';
import type { filterSessionVisibleOrganizations } from '../src/services/organizations.service';
import type { SessionVisibleOrganizationInput } from '../src/services/organizations.service.types';

export type FilterSessionVisibleOrganizations = typeof filterSessionVisibleOrganizations;

export function mockFilterSessionVisibleOrganizationsPassthrough(mock: Mock<FilterSessionVisibleOrganizations>): void {
  mock.mockImplementation(
    async <TOrganization extends SessionVisibleOrganizationInput>(
      organizations: TOrganization[],
      session: AuthSessionOrganizationPolicySession,
    ): Promise<TOrganization[]> => {
      void session;
      return await Promise.resolve(organizations);
    },
  );
}
