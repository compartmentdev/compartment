import type { OrganizationRow } from '../../queries/organizations.query.types';
import type { SsoOidcFlowRow, SsoOidcPrincipalRow } from '../../queries/sso-oidc.query.types';
import { buildAuthSessionOrganizationPolicySession } from '../auth-session.service';
import type { AuthSessionPlan } from '../auth-session.types';
import type { CliLoginSessionActor } from '../cli-login.service.types';
import type { AuthSessionOrganizationPolicySession } from '../organization-auth-settings.service.types';
import { listSessionVisibleOrganizations } from '../organizations.service';
import { completeCliLoginAttemptFromAuthenticatedSession } from '../cli-login.service';
import { readSsoOidcFlowTarget } from './sso-oidc-login.service.helpers';
import type { BrowserSsoLoginResult, CompleteSsoOidcLoginResult } from './sso-oidc.service.types';

export async function completeCliBrowserSsoLogin(
  flow: SsoOidcFlowRow,
  principal: SsoOidcPrincipalRow,
  session: AuthSessionPlan,
): Promise<CompleteSsoOidcLoginResult> {
  await completeCliLoginAttemptFromAuthenticatedSession({
    attemptId: requireCliLoginAttemptId(flow),
    session: buildCliLoginSessionActor(principal, session),
  });

  return {
    kind: 'cli_attempt_authenticated',
    sessionExpiresAt: session.expiresAt,
    sessionId: session.sessionId,
    sessionToken: session.sessionToken,
  };
}

function requireCliLoginAttemptId(flow: SsoOidcFlowRow): string {
  const cliLoginAttemptId: string | null = flow.cliLoginAttemptId;
  if (cliLoginAttemptId === null) {
    throw new Error('Expected CLI-bound SSO completion to include a CLI login attempt.');
  }

  return cliLoginAttemptId;
}

function buildCliLoginSessionActor(principal: SsoOidcPrincipalRow, session: AuthSessionPlan): CliLoginSessionActor {
  return {
    authMethodKind: session.authMethodKind,
    oidcProviderId: session.oidcProviderId,
    organizationId: session.organizationId,
    principalEmail: principal.principalEmail,
    principalId: principal.principalId,
  };
}

export async function issueBrowserSsoLoginResult(
  flow: SsoOidcFlowRow,
  principal: SsoOidcPrincipalRow,
  session: AuthSessionPlan,
): Promise<BrowserSsoLoginResult> {
  const authSession: AuthSessionOrganizationPolicySession = buildAuthSessionOrganizationPolicySession(
    session,
    principal.principalId,
  );
  const organizations: OrganizationRow[] = await listSessionVisibleOrganizations(authSession);

  return {
    authSession,
    flowTarget: readSsoOidcFlowTarget(flow),
    kind: 'browser_session',
    organizations,
    principalEmail: principal.principalEmail,
    principalId: principal.principalId,
    sessionExpiresAt: session.expiresAt,
    sessionId: session.sessionId,
    sessionToken: session.sessionToken,
  };
}
