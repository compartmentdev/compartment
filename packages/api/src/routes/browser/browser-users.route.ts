import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiApp } from '../../app.types';
import { browserOrganizationUsersPathnameTemplate } from '../../browser-public-paths';
import { sendAuthenticatedBrowserShell } from './browser-authenticated-shell.helpers';
import { browserPageRateLimitRouteOptions } from './browser-page-rate-limit.route';
import { renderBrowserUsersPage } from './browser-users.page';

export function registerBrowserUsersRoute(app: ApiApp): void {
  app.get(browserOrganizationUsersPathnameTemplate, browserPageRateLimitRouteOptions, handleBrowserUsersGet);
}

async function handleBrowserUsersGet(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  return await sendAuthenticatedBrowserShell(request, reply, renderBrowserUsersPage);
}
