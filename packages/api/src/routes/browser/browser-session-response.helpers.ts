import type { AppAccessBrowserFlowTarget } from '@compartment/contracts';
import type { FastifyReply } from 'fastify';
import { browserHomePathname, buildBrowserOrganizationProjectsPathname } from '../../browser-public-paths';
import { createForbiddenError } from '../../errors/api-business-error';
import { issueAppAccessRedirect } from '../../services/app-access.service';
import { requireInstalledCompartment } from '../../services/app-access-target.service';
import { createCompartmentSessionCookie } from '../../services/browser-session-cookie.service';
import type { AuthSessionOrganizationPolicySession } from '../../services/organization-auth-settings.service.types';
import type { OrganizationSummaryInput } from '../../services/presenter.types';
import type { BrowserFlowTargetOrNull } from './browser-flow.types';

interface BrowserSessionRedirectInput {
  extraCookies?: string[] | undefined;
  flowTarget: BrowserFlowTargetOrNull;
  selectedOrganizationSlug?: string | undefined;
  sessionExpiresAt: Date;
  sessionId: string;
  sessionToken: string;
}

interface AuthenticatedBrowserRedirectOptions {
  selectedOrganizationSlug?: string | undefined;
}

interface SelectedBrowserSessionOrganizationInput {
  authSession: AuthSessionOrganizationPolicySession;
  organizations: OrganizationSummaryInput[];
}

export async function sendBrowserSessionRedirect(
  reply: FastifyReply,
  input: BrowserSessionRedirectInput,
): Promise<FastifyReply> {
  if (input.flowTarget === null) {
    await requireInstalledCompartment();
  }
  const setCookies: string[] = [
    ...(input.extraCookies ?? []),
    createCompartmentSessionCookie(input.sessionToken, input.sessionExpiresAt),
  ];
  reply.header('Set-Cookie', setCookies.length === 1 ? setCookies[0] : setCookies);

  return await reply.redirect(
    await buildAuthenticatedBrowserRedirectUrl(input.sessionId, input.flowTarget, {
      selectedOrganizationSlug: input.selectedOrganizationSlug,
    }),
  );
}

export async function buildAuthenticatedBrowserRedirectUrl(
  sessionId: string,
  flowTarget: BrowserFlowTargetOrNull,
  options: AuthenticatedBrowserRedirectOptions = {},
): Promise<string> {
  return flowTarget === null
    ? buildBrowserProjectsRedirectUrl(options.selectedOrganizationSlug)
    : await buildBrowserAppAccessRedirectUrl(sessionId, flowTarget);
}

export function readSelectedBrowserSessionOrganizationSlug(
  input: SelectedBrowserSessionOrganizationInput,
): string | undefined {
  const selectedOrganizationId: string | null = input.authSession.organizationId;
  if (selectedOrganizationId === null) {
    return undefined;
  }

  const selectedOrganization: OrganizationSummaryInput | undefined = input.organizations.find(
    (organization: OrganizationSummaryInput): boolean => organization.id === selectedOrganizationId,
  );
  if (selectedOrganization === undefined) {
    throw createForbiddenError();
  }

  return selectedOrganization.slug;
}

export function buildBrowserProjectsRedirectUrl(selectedOrganizationSlug: string | undefined): string {
  return selectedOrganizationSlug === undefined
    ? browserHomePathname
    : buildBrowserOrganizationProjectsPathname(selectedOrganizationSlug);
}

async function buildBrowserAppAccessRedirectUrl(
  sessionId: string,
  flowTarget: AppAccessBrowserFlowTarget,
): Promise<string> {
  return await issueAppAccessRedirect({
    authSessionId: sessionId,
    host: flowTarget.host,
    redirectPath: flowTarget.path,
    state: flowTarget.state,
  });
}
