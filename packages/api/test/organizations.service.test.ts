import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type {
  findOrganizationRowForPrincipalBySlug,
  listOrganizationRowsForPrincipal,
} from '../src/queries/organizations.query';
import type { OrganizationRow } from '../src/queries/organizations.query.types';
import type { AuthSessionOrganizationPolicyInput } from '../src/services/organization-auth-settings.service.types';
import type { isAuthSessionPolicyAllowedForOrganization } from '../src/services/organization-auth-settings.service';
import { listSessionVisibleOrganizations } from '../src/services/organizations.service';

type IsAuthSessionPolicyAllowedForOrganization = typeof isAuthSessionPolicyAllowedForOrganization;
type FindOrganizationRowForPrincipalBySlug = typeof findOrganizationRowForPrincipalBySlug;
type ListOrganizationRowsForPrincipal = typeof listOrganizationRowsForPrincipal;

interface OrganizationsServiceMocks {
  findOrganizationRowForPrincipalBySlug: Mock<FindOrganizationRowForPrincipalBySlug>;
  isAuthSessionPolicyAllowedForOrganization: Mock<IsAuthSessionPolicyAllowedForOrganization>;
  listOrganizationRowsForPrincipal: Mock<ListOrganizationRowsForPrincipal>;
}

interface OrganizationsQueryModuleMock {
  findOrganizationRowForPrincipalBySlug: Mock<FindOrganizationRowForPrincipalBySlug>;
  listOrganizationRowsForPrincipal: Mock<ListOrganizationRowsForPrincipal>;
}

interface OrganizationAuthSettingsServiceModuleMock {
  isAuthSessionPolicyAllowedForOrganization: Mock<IsAuthSessionPolicyAllowedForOrganization>;
}

const mocks: OrganizationsServiceMocks = vi.hoisted(
  (): OrganizationsServiceMocks => ({
    findOrganizationRowForPrincipalBySlug: vi.fn<FindOrganizationRowForPrincipalBySlug>(),
    isAuthSessionPolicyAllowedForOrganization: vi.fn<IsAuthSessionPolicyAllowedForOrganization>(),
    listOrganizationRowsForPrincipal: vi.fn<ListOrganizationRowsForPrincipal>(),
  }),
);

vi.mock(
  '../src/queries/organizations.query',
  (): OrganizationsQueryModuleMock => ({
    findOrganizationRowForPrincipalBySlug: mocks.findOrganizationRowForPrincipalBySlug,
    listOrganizationRowsForPrincipal: mocks.listOrganizationRowsForPrincipal,
  }),
);

vi.mock(
  '../src/services/organization-auth-settings.service',
  (): OrganizationAuthSettingsServiceModuleMock => ({
    isAuthSessionPolicyAllowedForOrganization: mocks.isAuthSessionPolicyAllowedForOrganization,
  }),
);

describe('session-visible organizations', (): void => {
  beforeEach((): void => {
    mocks.findOrganizationRowForPrincipalBySlug.mockReset();
    mocks.isAuthSessionPolicyAllowedForOrganization.mockReset();
    mocks.listOrganizationRowsForPrincipal.mockReset();
  });

  it('keeps every allowed organization visible for a password multi-org session', async (): Promise<void> => {
    const organizations: OrganizationRow[] = [createOrganizationRow('org_123'), createOrganizationRow('org_456')];
    mocks.listOrganizationRowsForPrincipal.mockResolvedValueOnce(organizations);
    mocks.isAuthSessionPolicyAllowedForOrganization.mockResolvedValue(true);

    await expect(
      listSessionVisibleOrganizations({
        authMethodKind: 'password',
        oidcProviderId: null,
        organizationId: null,
        principalId: 'prn_123',
      }),
    ).resolves.toEqual(organizations);

    expect(mocks.isAuthSessionPolicyAllowedForOrganization).toHaveBeenCalledWith({
      organizationId: 'org_123',
      session: {
        authMethodKind: 'password',
        oidcProviderId: null,
        organizationId: null,
        principalId: 'prn_123',
      },
    });
    expect(mocks.isAuthSessionPolicyAllowedForOrganization).toHaveBeenCalledWith({
      organizationId: 'org_456',
      session: {
        authMethodKind: 'password',
        oidcProviderId: null,
        organizationId: null,
        principalId: 'prn_123',
      },
    });
  });

  it('hides other memberships from an organization-scoped OIDC multi-org session', async (): Promise<void> => {
    const visibleOrganization: OrganizationRow = createOrganizationRow('org_123');
    const hiddenOrganization: OrganizationRow = createOrganizationRow('org_456');
    mocks.listOrganizationRowsForPrincipal.mockResolvedValueOnce([visibleOrganization, hiddenOrganization]);
    mocks.isAuthSessionPolicyAllowedForOrganization.mockImplementation(
      async (input: AuthSessionOrganizationPolicyInput): Promise<boolean> =>
        await Promise.resolve(input.organizationId === 'org_123'),
    );

    await expect(
      listSessionVisibleOrganizations({
        authMethodKind: 'oidc',
        oidcProviderId: 'sop_123',
        organizationId: 'org_123',
        principalId: 'prn_123',
      }),
    ).resolves.toEqual([visibleOrganization]);
  });
});

function createOrganizationRow(id: string): OrganizationRow {
  return {
    id,
    name: id === 'org_123' ? 'Acme Dev' : 'Hidden Org',
    slug: id === 'org_123' ? 'acme-dev' : 'hidden-org',
  };
}
