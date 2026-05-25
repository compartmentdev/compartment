import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { ApiApp } from '../../app.types';
import { browserActivatePathname } from '../../browser-public-paths';
import { parseRequestValue } from '../../http/validation';
import { readActivationTokenExpiresAt } from '../../services/activation-token-expiration.service';
import { requireInstalledCompartment } from '../../services/app-access-target.service';
import { createBrowserAuthTokenFlowPlan } from '../../services/browser-auth-token-flow.service';
import type { BrowserAuthTokenFlowPlan } from '../../services/browser-auth-token-flow.service.types';
import {
  createClearedBrowserActivateFlowCookie,
  createBrowserActivateFlowCookie,
  createClearedLegacyBrowserActivateTokenCookie,
} from '../../services/browser-activate-flow-cookie.service';
import { createBrowserCsrfCookie } from '../../services/browser-csrf-cookie.service';
import { buildBrowserActivateGetUrl } from './browser-activate.route.helpers';
import { replyWithBrowserAuthTokenLanding } from './browser-auth-token-landing.route.helpers';
import type { BrowserActivateQuery } from './browser-activate.route.types';
import { createBrowserFlowFieldSchemaShape } from './browser-flow.helpers';
import { browserPageRateLimitRouteOptions } from './browser-page-rate-limit.route';

const browserActivateQuerySchema: z.ZodType<BrowserActivateQuery> = z.object({
  ...createBrowserFlowFieldSchemaShape(),
  email: z.string().email().optional(),
  token: z.string().min(1).optional(),
});

export function registerBrowserActivateRoute(app: ApiApp): void {
  app.get(browserActivatePathname, browserPageRateLimitRouteOptions, handleBrowserActivateGet);
}

async function handleBrowserActivateGet(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  await requireInstalledCompartment();
  const query: BrowserActivateQuery = parseRequestValue(
    browserActivateQuerySchema,
    request.query,
    'invalid_browser_activate_query',
  );

  return await replyWithBrowserAuthTokenLanding(
    reply,
    query,
    'Activate access',
    createBrowserActivateFlowCookies,
    createBrowserActivateShellCookies,
    buildBrowserActivateGetUrl,
  );
}

async function createBrowserActivateFlowCookies(query: BrowserActivateQuery, token: string): Promise<string[]> {
  const sourceTokenExpiresAt: Date | undefined = await readActivationTokenExpiresAt(token, query.email);
  if (sourceTokenExpiresAt === undefined) {
    return createBrowserActivateFlowClearCookies();
  }

  const flow: BrowserAuthTokenFlowPlan | undefined = await createBrowserAuthTokenFlowPlan({
    kind: 'activation',
    sourceTokenExpiresAt,
    token,
  });
  if (flow === undefined) {
    return createBrowserActivateFlowClearCookies();
  }

  return [
    createClearedLegacyBrowserActivateTokenCookie(),
    createBrowserActivateFlowCookie(flow.flowId, flow.expiresAt),
  ];
}

function createBrowserActivateShellCookies(): string[] {
  return [createBrowserCsrfCookie(), createClearedLegacyBrowserActivateTokenCookie()];
}

function createBrowserActivateFlowClearCookies(): string[] {
  return [createClearedLegacyBrowserActivateTokenCookie(), createClearedBrowserActivateFlowCookie()];
}
