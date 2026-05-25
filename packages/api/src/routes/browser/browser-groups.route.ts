import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiApp } from '../../app.types';
import { browserOrganizationGroupsPathnameTemplate } from '../../browser-public-paths';
import { sendAuthenticatedBrowserShell } from './browser-authenticated-shell.helpers';
import { renderBrowserGroupsPage } from './browser-groups.page';
import { browserPageRateLimitRouteOptions } from './browser-page-rate-limit.route';

export function registerBrowserGroupsRoute(app: ApiApp): void {
  app.get(browserOrganizationGroupsPathnameTemplate, browserPageRateLimitRouteOptions, handleBrowserGroupsGet);
}

async function handleBrowserGroupsGet(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  return await sendAuthenticatedBrowserShell(request, reply, renderBrowserGroupsPage);
}
