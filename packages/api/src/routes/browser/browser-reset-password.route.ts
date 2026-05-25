import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { ApiApp } from '../../app.types';
import { browserResetPasswordPathname } from '../../browser-public-paths';
import { parseRequestValue } from '../../http/validation';
import { requireInstalledCompartment } from '../../services/app-access-target.service';
import { createBrowserAuthTokenFlowPlan } from '../../services/browser-auth-token-flow.service';
import type { BrowserAuthTokenFlowPlan } from '../../services/browser-auth-token-flow.service.types';
import {
  createClearedBrowserResetPasswordFlowCookie,
  createBrowserResetPasswordFlowCookie,
  createClearedLegacyBrowserResetPasswordTokenCookie,
} from '../../services/browser-reset-password-flow-cookie.service';
import { createBrowserCsrfCookie } from '../../services/browser-csrf-cookie.service';
import { readPasswordResetTokenExpiresAt } from '../../services/password-reset-token-expiration.service';
import { replyWithBrowserAuthTokenLanding } from './browser-auth-token-landing.route.helpers';
import { createBrowserFlowFieldSchemaShape } from './browser-flow.helpers';
import { browserPageRateLimitRouteOptions } from './browser-page-rate-limit.route';
import { buildBrowserResetPasswordGetUrl } from './browser-reset-password.route.helpers';
import type { BrowserResetPasswordQuery } from './browser-reset-password.route.types';

const browserResetPasswordQuerySchema: z.ZodType<BrowserResetPasswordQuery> = z.object({
  ...createBrowserFlowFieldSchemaShape(),
  email: z.string().email().optional(),
  token: z.string().min(1).optional(),
});

export function registerBrowserResetPasswordRoute(app: ApiApp): void {
  app.get(browserResetPasswordPathname, browserPageRateLimitRouteOptions, handleBrowserResetPasswordGet);
}

async function handleBrowserResetPasswordGet(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  await requireInstalledCompartment();
  const query: BrowserResetPasswordQuery = parseRequestValue(
    browserResetPasswordQuerySchema,
    request.query,
    'invalid_browser_reset_password_query',
  );

  return await replyWithBrowserAuthTokenLanding(
    reply,
    query,
    'Reset password',
    createBrowserResetPasswordFlowCookies,
    createBrowserResetPasswordShellCookies,
    buildBrowserResetPasswordGetUrl,
  );
}

async function createBrowserResetPasswordFlowCookies(
  query: BrowserResetPasswordQuery,
  token: string,
): Promise<string[]> {
  const sourceTokenExpiresAt: Date | undefined = await readPasswordResetTokenExpiresAt(query.email, token);
  if (sourceTokenExpiresAt === undefined) {
    return createBrowserResetPasswordFlowClearCookies();
  }

  const flow: BrowserAuthTokenFlowPlan | undefined = await createBrowserAuthTokenFlowPlan({
    kind: 'password_reset',
    sourceTokenExpiresAt,
    token,
  });
  if (flow === undefined) {
    return createBrowserResetPasswordFlowClearCookies();
  }

  return [
    createClearedLegacyBrowserResetPasswordTokenCookie(),
    createBrowserResetPasswordFlowCookie(flow.flowId, flow.expiresAt),
  ];
}

function createBrowserResetPasswordShellCookies(): string[] {
  return [createBrowserCsrfCookie(), createClearedLegacyBrowserResetPasswordTokenCookie()];
}

function createBrowserResetPasswordFlowClearCookies(): string[] {
  return [createClearedLegacyBrowserResetPasswordTokenCookie(), createClearedBrowserResetPasswordFlowCookie()];
}
