import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiApp } from '../../app.types';
import { browserOrganizationProjectOverviewPathnameTemplate } from '../../browser-public-paths';
import { sendAuthenticatedBrowserShell } from './browser-authenticated-shell.helpers';
import { browserPageRateLimitRouteOptions } from './browser-page-rate-limit.route';
import { renderBrowserProjectOverviewPage } from './browser-project-overview.page';

export function registerBrowserProjectOverviewRoute(app: ApiApp): void {
  app.get(
    browserOrganizationProjectOverviewPathnameTemplate,
    browserPageRateLimitRouteOptions,
    handleBrowserProjectOverview,
  );
}

async function handleBrowserProjectOverview(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  return await sendAuthenticatedBrowserShell(request, reply, renderBrowserProjectOverviewPage);
}
