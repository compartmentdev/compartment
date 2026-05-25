import {
  buildFastifyResponseSchemas,
  loginStateQuerySchema,
  loginStateResponseSchema,
  type LoginStateQuery,
  type LoginStateResponse,
} from '@compartment/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiApp } from '../../app.types';
import { parseRequestValue } from '../../http/validation';
import { authenticateBrowserCompartmentSession, canIssueAppAccessRedirect } from '../../services/app-access.service';
import type { BrowserCompartmentSession } from '../../services/app-access.service.types';
import { requireInstalledCompartment } from '../../services/app-access-target.service';
import {
  type BrowserCliLoginCompletionResult,
  completeCliLoginAttemptFromBrowserSessionCookie,
  readCliLoginAttemptFromBrowserCookie,
  type BrowserCliLoginAttemptReadResult,
} from '../../services/browser-cli-login-flow.service';
import {
  createClearedBrowserCliLoginAttemptCookie,
  readBrowserCliLoginAttemptCookie,
} from '../../services/browser-cli-login-attempt-cookie.service';
import type { CliBrowserLoginAttempt, CliLoginSessionActor } from '../../services/cli-login.service.types';
import {
  discoverBrowserLoginState,
  readInitialBrowserLoginState,
  readTrustedInitialBrowserLoginState,
} from '../../services/browser-login-flow.service';
import type { BrowserLoginFlowState, BrowserLoginRedirectState } from '../../services/browser-login-flow.service.types';
import { listSessionVisibleOrganizations } from '../../services/organizations.service';
import type { OrganizationSummaryInput } from '../../services/presenter.types';
import { readCompartmentSessionToken, readFlowTarget } from '../browser/browser-flow.helpers';
import type { BrowserFlowTargetOrNull } from '../browser/browser-flow.types';
import { authApiLoginStatePathname } from './auth-api-paths';
import {
  buildAuthenticatedBrowserRedirectUrl,
  readSelectedBrowserSessionOrganizationSlug,
} from './auth-browser-redirects';
import { authRateLimitRouteOptions } from './auth-rate-limit.route';
import { buildLoginStateResponse } from './auth-state.presenter';
import { buildCliLoginCompletedUrl } from '../browser/browser-cli-login.page';

export function registerGetLoginStateRoute(app: ApiApp): void {
  app.get(
    authApiLoginStatePathname,
    {
      ...authRateLimitRouteOptions,
      schema: {
        response: buildFastifyResponseSchemas({
          200: loginStateResponseSchema,
        }),
      },
    },
    handleGetLoginState,
  );
}

async function handleGetLoginState(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  await requireInstalledCompartment();
  const query: LoginStateQuery = parseRequestValue(loginStateQuerySchema, request.query, 'invalid_login_state_query');
  const allowAutoRedirect: boolean = query.autoRedirect ?? true;
  const flowTarget: BrowserFlowTargetOrNull = readFlowTarget(query);
  const session: BrowserCompartmentSession | null = await authenticateBrowserCompartmentSession(
    readCompartmentSessionToken(request),
  );
  const redirectResponse: LoginStateResponse | null = await readLoginStateRedirectResponse(
    request,
    reply,
    session,
    flowTarget,
    allowAutoRedirect,
  );
  const response: LoginStateResponse =
    redirectResponse ??
    buildLoginStateResponse(
      await readInitialBrowserLoginState(flowTarget, allowAutoRedirect),
      flowTarget,
      session?.principalEmail,
    );

  return await reply.send(loginStateResponseSchema.parse(response));
}

async function readLoginStateRedirectResponse(
  request: FastifyRequest,
  reply: FastifyReply,
  session: BrowserCompartmentSession | null,
  flowTarget: BrowserFlowTargetOrNull,
  allowAutoRedirect: boolean,
): Promise<LoginStateResponse | null> {
  const cliRedirectResponse: LoginStateResponse | null = await readCliLoginStateRedirectResponse(
    request,
    reply,
    session,
    flowTarget,
  );
  if (cliRedirectResponse !== null) {
    return cliRedirectResponse;
  }
  if (!shouldReadAuthenticatedBrowserRedirect(request.headers.cookie, session, allowAutoRedirect)) {
    return null;
  }

  return await readAuthenticatedBrowserRedirectResponse(session, flowTarget);
}

async function readCliLoginStateRedirectResponse(
  request: FastifyRequest,
  reply: FastifyReply,
  session: BrowserCompartmentSession | null,
  flowTarget: BrowserFlowTargetOrNull,
): Promise<LoginStateResponse | null> {
  const result: BrowserCliLoginAttemptReadResult = await readCliLoginAttemptFromBrowserCookie(request.headers.cookie);
  if (result.status === 'missing') {
    return null;
  }
  if (result.status === 'invalid') {
    reply.header('Set-Cookie', createClearedBrowserCliLoginAttemptCookie());
    return buildCliAttemptRedirectState(session?.principalEmail, 'failed');
  }

  const completionResponse: LoginStateResponse | null = await readCliLoginAttemptCompletionResponse(
    request,
    reply,
    session,
  );
  if (completionResponse !== null) {
    return completionResponse;
  }

  return await buildActiveCliLoginStateResponse(flowTarget, session?.principalEmail, result.attempt, session === null);
}

async function readCliLoginAttemptCompletionResponse(
  request: FastifyRequest,
  reply: FastifyReply,
  session: BrowserCompartmentSession | null,
): Promise<LoginStateResponse | null> {
  if (session === null) {
    return null;
  }

  const completion: BrowserCliLoginCompletionResult = await completeCliLoginAttemptFromBrowserSessionCookie(
    request.headers.cookie,
    toCliLoginSessionActor(session),
  );
  if (completion === 'completed') {
    reply.header('Set-Cookie', createClearedBrowserCliLoginAttemptCookie());
    return buildCliAttemptRedirectState(session.principalEmail, 'success');
  }
  if (completion === 'invalid') {
    reply.header('Set-Cookie', createClearedBrowserCliLoginAttemptCookie());
    return buildCliAttemptRedirectState(session.principalEmail, 'failed');
  }

  return null;
}

async function readAuthenticatedBrowserRedirectResponse(
  session: BrowserCompartmentSession,
  flowTarget: BrowserFlowTargetOrNull,
): Promise<LoginStateResponse | null> {
  if (
    flowTarget !== null &&
    !(await canIssueAppAccessRedirect({
      host: flowTarget.host,
      path: flowTarget.path,
      sessionId: session.sessionId,
    }))
  ) {
    return null;
  }

  const redirectState: BrowserLoginRedirectState = {
    kind: 'redirect',
    redirectUrl: await buildAuthenticatedBrowserRedirectUrl(session.sessionId, flowTarget, {
      selectedOrganizationSlug: await readAuthenticatedBrowserRedirectOrganizationSlug(session, flowTarget),
    }),
  };

  return buildLoginStateResponse(redirectState, flowTarget, session.principalEmail);
}

async function readAuthenticatedBrowserRedirectOrganizationSlug(
  session: BrowserCompartmentSession,
  flowTarget: BrowserFlowTargetOrNull,
): Promise<string | undefined> {
  if (flowTarget !== null || session.authSession.organizationId === null) {
    return undefined;
  }

  const organizations: OrganizationSummaryInput[] = await listSessionVisibleOrganizations(session.authSession);
  return readSelectedBrowserSessionOrganizationSlug({
    authSession: session.authSession,
    organizations,
  });
}

function shouldReadAuthenticatedBrowserRedirect(
  cookieHeader: string | undefined,
  session: BrowserCompartmentSession | null,
  allowAutoRedirect: boolean,
): session is BrowserCompartmentSession {
  if (session === null) {
    return false;
  }

  return allowAutoRedirect && readBrowserCliLoginAttemptCookie(cookieHeader) === undefined;
}

function buildCliAttemptRedirectState(
  principalEmail: string | undefined,
  status: 'failed' | 'success',
): LoginStateResponse {
  return {
    flowTarget: null,
    ...(principalEmail !== undefined ? { principalEmail } : {}),
    redirectTo: buildCliLoginCompletedUrl(status),
    view: 'redirect',
  };
}

async function buildActiveCliLoginStateResponse(
  flowTarget: BrowserFlowTargetOrNull,
  principalEmail: string | undefined,
  attempt: CliBrowserLoginAttempt,
  allowAutoRedirect: boolean,
): Promise<LoginStateResponse> {
  const state: BrowserLoginFlowState =
    attempt.expectedPrincipalEmail === undefined && attempt.organizationSlug === undefined
      ? await readTrustedInitialBrowserLoginState(flowTarget, allowAutoRedirect)
      : await discoverBrowserLoginState(
          {
            ...(attempt.expectedPrincipalEmail !== undefined ? { email: attempt.expectedPrincipalEmail } : {}),
            flowTarget,
            organizationSlug: attempt.organizationSlug,
          },
          allowAutoRedirect,
        );

  return buildLoginStateResponse(state, flowTarget, principalEmail);
}

function toCliLoginSessionActor(session: BrowserCompartmentSession): CliLoginSessionActor {
  return {
    authMethodKind: session.authSession.authMethodKind,
    oidcProviderId: session.authSession.oidcProviderId,
    organizationId: session.authSession.organizationId,
    principalEmail: session.principalEmail,
    principalId: session.principalId,
  };
}
