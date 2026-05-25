import type { SsoOidcPrincipalRow, SsoOidcProviderRow } from '../../queries/sso-oidc.query.types';
import type { AuthSessionPlan } from '../auth-session.types';
import type { OidcIdentityClaims } from './sso-oidc-client.adapter.types';

export interface ResolveSsoOidcLoginSessionInput {
  claims: OidcIdentityClaims;
  provider: SsoOidcProviderRow;
}

export interface ResolveSsoOidcPrincipalResult {
  autoJoined: boolean;
  principal: SsoOidcPrincipalRow;
}

export interface ResolveSsoOidcLoginSessionResult {
  principal: SsoOidcPrincipalRow;
  session: AuthSessionPlan;
}
