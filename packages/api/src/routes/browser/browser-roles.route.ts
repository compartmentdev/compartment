import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiApp } from '../../app.types';
import { browserOrganizationRolesPathnameTemplate } from '../../browser-public-paths';
import { sendAuthenticatedBrowserShell } from './browser-authenticated-shell.helpers';
import { renderBrowserRolesPage } from './browser-roles.page';
import { browserPageRateLimitRouteOptions } from './browser-page-rate-limit.route';

export function registerBrowserRolesRoute(app: ApiApp): void {
  app.get(browserOrganizationRolesPathnameTemplate, browserPageRateLimitRouteOptions, handleBrowserRolesGet);
}

async function handleBrowserRolesGet(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  return await sendAuthenticatedBrowserShell(request, reply, renderBrowserRolesPage);
}
