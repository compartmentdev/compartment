import type { OrganizationSummary, PrincipalSummary } from '@compartment/contracts';
import type { AuthSessionOrganizationPolicySession } from '../../services/organization-auth-settings.service.types';
import { filterSessionVisibleOrganizations } from '../../services/organizations.service';
import type { OrganizationSummaryInput } from '../../services/presenter.types';
import type { BrowserFlowTargetOrNull } from '../browser/browser-flow.types';
import { buildOrganizationSummaries } from '../presenters/organization.presenter';
import { buildPrincipalSummary } from '../presenters/principal.presenter';
import {
  buildAuthenticatedBrowserRedirectUrl,
  readSelectedBrowserSessionOrganizationSlug,
} from './auth-browser-redirects';
import { type ResolvedAuthSessionDelivery, usesSessionCookie } from './auth-token-input.helpers';

interface AuthSessionResponseResult {
  authSession: AuthSessionOrganizationPolicySession;
  organizations: OrganizationSummaryInput[];
  principalEmail: string;
  principalId: string;
  sessionId: string;
  sessionToken: string;
}

interface BuildAuthSessionResponseFieldsInput {
  flowTarget: BrowserFlowTargetOrNull;
  redirectToOverride?: string | undefined;
  result: AuthSessionResponseResult;
  sessionDelivery: ResolvedAuthSessionDelivery;
}

interface AuthSessionResponseBaseFields {
  organizations: OrganizationSummary[];
  principal: PrincipalSummary;
}

interface AuthSessionCookieResponseFields extends AuthSessionResponseBaseFields {
  redirectTo: string;
}

interface AuthSessionTokenResponseFields extends AuthSessionResponseBaseFields {
  sessionToken: string;
}

type AuthSessionResponseFields = AuthSessionCookieResponseFields | AuthSessionTokenResponseFields;

export async function buildAuthSessionResponseFields(
  input: BuildAuthSessionResponseFieldsInput,
): Promise<AuthSessionResponseFields> {
  const usesCookieSession: boolean = usesSessionCookie(input.sessionDelivery);
  const organizations: OrganizationSummaryInput[] = await readAuthSessionResponseOrganizations(input.result);
  const baseFields: AuthSessionResponseBaseFields = buildAuthSessionResponseBaseFields(
    organizations,
    input.result.principalEmail,
    input.result.principalId,
  );
  if (usesCookieSession) {
    return {
      ...baseFields,
      redirectTo: await buildAuthSessionCookieRedirectTo(input, organizations),
    };
  }

  return {
    ...baseFields,
    sessionToken: input.result.sessionToken,
  };
}

async function buildAuthSessionCookieRedirectTo(
  input: BuildAuthSessionResponseFieldsInput,
  organizations: OrganizationSummaryInput[],
): Promise<string> {
  if (input.redirectToOverride !== undefined) {
    return input.redirectToOverride;
  }

  return await buildAuthenticatedBrowserRedirectUrl(input.result.sessionId, input.flowTarget, {
    selectedOrganizationSlug: readSelectedBrowserSessionOrganizationSlug({
      authSession: input.result.authSession,
      organizations,
    }),
  });
}

async function readAuthSessionResponseOrganizations(
  result: AuthSessionResponseResult,
): Promise<OrganizationSummaryInput[]> {
  return await filterSessionVisibleOrganizations(result.organizations, result.authSession);
}

export function buildAuthSessionResponseBaseFields(
  organizations: OrganizationSummaryInput[],
  principalEmail: string,
  principalId: string,
): AuthSessionResponseBaseFields {
  return {
    organizations: buildOrganizationSummaries(organizations),
    principal: buildPrincipalSummary({
      email: principalEmail,
      id: principalId,
      type: 'user',
    }),
  };
}
