import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { AuthSessionPlan } from '../../src/services/auth-session.types';
import type { OrganizationRow } from '../../src/queries/organizations.query.types';
import type { SsoOidcFlowRow, SsoOidcPrincipalRow } from '../../src/queries/sso-oidc.query.types';
import type { listSessionVisibleOrganizations } from '../../src/services/organizations.service';
import { issueBrowserSsoLoginResult } from '../../src/services/sso-oidc/sso-oidc-login-completion.service';

type ListSessionVisibleOrganizations = typeof listSessionVisibleOrganizations;

interface SsoOidcLoginCompletionServiceMocks {
  listSessionVisibleOrganizations: Mock<ListSessionVisibleOrganizations>;
}

const mocks: SsoOidcLoginCompletionServiceMocks = vi.hoisted(
  (): SsoOidcLoginCompletionServiceMocks => ({
    listSessionVisibleOrganizations: vi.fn<ListSessionVisibleOrganizations>(),
  }),
);

vi.mock(
  '../../src/services/organizations.service',
  (): { listSessionVisibleOrganizations: Mock<ListSessionVisibleOrganizations> } => ({
    listSessionVisibleOrganizations: mocks.listSessionVisibleOrganizations,
  }),
);

describe('SSO OIDC login completion', (): void => {
  beforeEach((): void => {
    mocks.listSessionVisibleOrganizations.mockReset();
  });

  it('returns only session-visible organizations for browser OIDC completion', async (): Promise<void> => {
    const visibleOrganization: OrganizationRow = createOrganizationRow('org_123');
    mocks.listSessionVisibleOrganizations.mockResolvedValueOnce([visibleOrganization]);

    await expect(
      issueBrowserSsoLoginResult(createFlowRow(), createPrincipalRow(), createAuthSessionPlan()),
    ).resolves.toMatchObject({
      authSession: {
        authMethodKind: 'oidc',
        oidcProviderId: 'sop_123',
        organizationId: 'org_123',
        principalId: 'prn_123',
      },
      kind: 'browser_session',
      organizations: [visibleOrganization],
    });
    expect(mocks.listSessionVisibleOrganizations).toHaveBeenCalledWith({
      authMethodKind: 'oidc',
      oidcProviderId: 'sop_123',
      organizationId: 'org_123',
      principalId: 'prn_123',
    });
  });
});

function createAuthSessionPlan(): AuthSessionPlan {
  return {
    authMethodKind: 'oidc',
    expiresAt: new Date('2099-04-21T10:20:00.000Z'),
    oidcProviderId: 'sop_123',
    organizationId: 'org_123',
    sessionId: 'ses_123',
    sessionToken: 'session-token',
    tokenHash: 'token-hash',
  };
}

function createFlowRow(): SsoOidcFlowRow {
  return {
    cliLoginAttemptId: null,
    consumedAt: new Date('2026-04-21T10:00:00.000Z'),
    createdAt: new Date('2026-04-21T09:59:00.000Z'),
    expiresAt: new Date('2026-04-21T10:10:00.000Z'),
    flowHost: null,
    flowPath: null,
    flowState: null,
    id: 'sof_123',
    nonce: 'nonce',
    oidcState: 'oidc-state',
    pkceCodeVerifier: 'pkce-code-verifier',
    providerId: 'sop_123',
    stateHash: 'state-hash',
  };
}

function createOrganizationRow(id: string): OrganizationRow {
  return {
    id,
    name: 'Acme Dev',
    slug: 'acme-dev',
  };
}

function createPrincipalRow(): SsoOidcPrincipalRow {
  return {
    principalEmail: 'admin@example.com',
    principalId: 'prn_123',
    principalType: 'user',
  };
}
