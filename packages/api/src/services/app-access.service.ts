import {
  appAccessFlowTtlSeconds,
  type AppAccessBrowserFlowTarget,
  type AppAccessExchangeRequest,
} from '@compartment/contracts';
import { hasText } from '@compartment/utils';
import type { ApiConfig } from '../config';
import { createInvalidAppAccessCodeError } from '../errors/api-business-error';
import { createId, createToken, hashToken } from '../lib/tokens';
import { findActiveAuthenticationSessionById } from '../queries/authentication.query';
import type { AuthSessionActorRow } from '../queries/authentication.query.types';
import {
  consumeAppAccessCode,
  createAppAccessCode,
  createAppAccessSession,
  findAppAccessCodeByTokenHash,
  findActiveAppAccessSessionByTokenHash,
  revokeAppAccessSession,
} from '../queries/app-access.query';
import type { ActiveAppAccessSessionRow, AppAccessCodeRow } from '../queries/app-access.query.types';
import { getApiConfig } from '../runtime/runtime-access';
import { authenticateSession } from './authentication.service';
import type { Actor } from './auth-actor.types';
import { isAuthSessionAllowedForOrganization } from './organization-auth-settings.service';
import { canAuthSessionAccessAppRoute } from './app-access-authorization.service';
import {
  buildAppCallbackUrl,
  requireExchangeFlowTarget,
  requireKnownBrowserFlowTarget,
} from './app-access-target.service';
import type {
  AppAccessExchangeResult,
  BrowserCompartmentSession,
  CanIssueAppAccessRedirectInput,
  IssueAppAccessRedirectInput,
} from './app-access.service.types';

const millisecondsPerSecond: number = 1000;
const appAccessCodeTtlMs: number = appAccessFlowTtlSeconds * millisecondsPerSecond;

interface AppAccessExchangeContext {
  authSession: AuthSessionActorRow;
  code: AppAccessCodeRow;
  config: ApiConfig;
}

interface BrowserSessionActorContext {
  actor: Actor;
  session: AuthSessionActorRow;
}

export async function authenticateBrowserCompartmentActor(sessionToken: string | undefined): Promise<Actor | null> {
  if (!hasText(sessionToken)) {
    return null;
  }

  const context: BrowserSessionActorContext | null = await readBrowserSessionActorContext(sessionToken);
  return context?.actor ?? null;
}

export async function authenticateBrowserCompartmentSession(
  sessionToken: string | undefined,
): Promise<BrowserCompartmentSession | null> {
  if (!hasText(sessionToken)) {
    return null;
  }

  const context: BrowserSessionActorContext | null = await readBrowserSessionActorContext(sessionToken);
  if (context === null) {
    return null;
  }

  return buildBrowserCompartmentSession(context, sessionToken);
}

export async function issueAppAccessRedirect(input: IssueAppAccessRedirectInput): Promise<string> {
  const flowTarget: AppAccessBrowserFlowTarget = await requireKnownBrowserFlowTarget({
    host: input.host,
    path: input.redirectPath,
    state: input.state,
  });
  await requireSessionAllowedForAppRoute({
    host: flowTarget.host,
    path: flowTarget.path,
    sessionId: input.authSessionId,
  });
  const config: ApiConfig = getApiConfig();
  const codeToken: string = createToken();

  await createAppAccessCode({
    authSessionId: input.authSessionId,
    expiresAt: new Date(Date.now() + appAccessCodeTtlMs),
    host: flowTarget.host,
    id: createId('aac'),
    redirectPath: flowTarget.path,
    state: flowTarget.state,
    tokenHash: hashToken(codeToken, config.sessionSecret),
  });

  return buildAppCallbackUrl(flowTarget.host, codeToken, flowTarget.state);
}

export async function exchangeAppAccessCode(input: AppAccessExchangeRequest): Promise<AppAccessExchangeResult> {
  const flowTarget: AppAccessExchangeRequest = await requireExchangeFlowTarget(input);
  const exchangeContext: AppAccessExchangeContext = await readAppAccessExchangeContext(flowTarget);
  const appSessionToken: string = createToken();

  await createAppAccessSession({
    authSessionId: exchangeContext.authSession.sessionId,
    expiresAt: exchangeContext.authSession.expiresAt,
    host: flowTarget.host,
    id: createId('aps'),
    tokenHash: hashToken(appSessionToken, exchangeContext.config.sessionSecret),
  });

  return buildAppAccessExchangeResponse(appSessionToken, flowTarget.host, exchangeContext);
}

export async function canIssueAppAccessRedirect(input: CanIssueAppAccessRedirectInput): Promise<boolean> {
  const session: AuthSessionActorRow | undefined = await findActiveAuthenticationSessionById(input.sessionId);
  if (session?.principalType !== 'user') {
    return false;
  }

  return await canAuthSessionAccessAppRoute({
    host: input.host,
    path: input.path,
    session,
  });
}

export async function logoutAppAccessSession(appSessionToken: string | null): Promise<void> {
  if (!hasText(appSessionToken)) {
    return;
  }

  const config: ApiConfig = getApiConfig();
  const appSession: ActiveAppAccessSessionRow | undefined = await findActiveAppAccessSessionByTokenHash(
    hashToken(appSessionToken, config.sessionSecret),
  );
  if (appSession === undefined) {
    return;
  }

  await revokeAppAccessSession(appSession.appSessionId, new Date());
}

async function readBrowserSessionActorContext(sessionToken: string): Promise<BrowserSessionActorContext | null> {
  const actor: Actor | null = await authenticateSession(sessionToken);
  if (actor === null) {
    return null;
  }

  const session: AuthSessionActorRow | undefined = await findActiveAuthenticationSessionById(actor.sessionId);
  if (session?.principalType !== 'user') {
    return null;
  }
  if (!(await isBrowserSessionAllowed(session))) {
    return null;
  }

  return { actor, session };
}

function buildBrowserCompartmentSession(
  context: BrowserSessionActorContext,
  sessionToken: string,
): BrowserCompartmentSession {
  return {
    authSession: context.actor.authSession,
    expiresAt: context.session.expiresAt,
    principalEmail: context.actor.principalEmail,
    principalId: context.actor.principalId,
    sessionId: context.actor.sessionId,
    sessionToken,
  };
}

async function isBrowserSessionAllowed(session: AuthSessionActorRow): Promise<boolean> {
  if (session.organizationId === null) {
    return false;
  }

  return await isAuthSessionAllowedForOrganization({
    organizationId: session.organizationId,
    session,
  });
}

async function requireSessionAllowedForAppRoute(input: CanIssueAppAccessRedirectInput): Promise<void> {
  const session: AuthSessionActorRow | undefined = await findActiveAuthenticationSessionById(input.sessionId);
  if (
    session?.principalType !== 'user' ||
    !(await canAuthSessionAccessAppRoute({
      host: input.host,
      path: input.path,
      session,
    }))
  ) {
    throw createInvalidAppAccessCodeError();
  }
}

async function readAppAccessExchangeContext(flowTarget: AppAccessExchangeRequest): Promise<AppAccessExchangeContext> {
  const config: ApiConfig = getApiConfig();
  const codeTokenHash: string = hashToken(flowTarget.code, config.sessionSecret);
  const code: AppAccessCodeRow = await requireUnconsumedAccessCode(codeTokenHash);
  const authSession: AuthSessionActorRow = await readExchangeableAuthSession(code, flowTarget);
  await consumeValidatedAppAccessCode(code.id);

  return {
    authSession,
    code,
    config,
  };
}

async function readExchangeableAuthSession(
  code: AppAccessCodeRow,
  flowTarget: AppAccessExchangeRequest,
): Promise<AuthSessionActorRow> {
  const authSession: AuthSessionActorRow | undefined = await findActiveAuthenticationSessionById(code.authSessionId);
  if (authSession?.principalType !== 'user' || code.host !== flowTarget.host || code.state !== flowTarget.state) {
    throw createInvalidAppAccessCodeError();
  }
  if (
    !(await canAuthSessionAccessAppRoute({
      host: code.host,
      path: code.redirectPath,
      session: authSession,
    }))
  ) {
    throw createInvalidAppAccessCodeError();
  }

  return authSession;
}

async function consumeValidatedAppAccessCode(codeId: string): Promise<void> {
  const wasConsumed: boolean = await consumeAppAccessCode(codeId, new Date());
  if (!wasConsumed) {
    throw createInvalidAppAccessCodeError();
  }
}

function buildAppAccessExchangeResponse(
  appSessionToken: string,
  host: string,
  exchangeContext: AppAccessExchangeContext,
): AppAccessExchangeResult {
  return {
    appSessionToken,
    redirectPath: exchangeContext.code.redirectPath,
    session: {
      authSessionId: exchangeContext.authSession.sessionId,
      expiresAt: exchangeContext.authSession.expiresAt,
      host,
      principalEmail: exchangeContext.authSession.principalEmail,
      principalId: exchangeContext.authSession.principalId,
      principalType: 'user',
    },
  };
}

async function requireUnconsumedAccessCode(tokenHash: string): Promise<AppAccessCodeRow> {
  const code: AppAccessCodeRow | undefined = await findAppAccessCodeByTokenHash(tokenHash);
  if (code === undefined) {
    throw createInvalidAppAccessCodeError();
  }

  if (code.consumedAt !== null || code.expiresAt <= new Date()) {
    throw createInvalidAppAccessCodeError();
  }

  return code;
}
