import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiApp } from '../../app.types';
import { browserOrganizationAuditPathnameTemplate } from '../../browser-public-paths';
import { sendAuthenticatedBrowserShell } from './browser-authenticated-shell.helpers';
import { browserPageRateLimitRouteOptions } from './browser-page-rate-limit.route';
import { renderBrowserAuditPage } from './browser-audit.page';

export function registerBrowserAuditRoute(app: ApiApp): void {
  app.get(browserOrganizationAuditPathnameTemplate, browserPageRateLimitRouteOptions, handleBrowserAuditGet);
}

async function handleBrowserAuditGet(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  return await sendAuthenticatedBrowserShell(request, reply, renderBrowserAuditPage);
}
