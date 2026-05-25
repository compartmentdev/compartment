import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiApp } from '../../app.types';
import { browserOrganizationProjectsPathnameTemplate } from '../../browser-public-paths';
import { sendAuthenticatedBrowserShell } from './browser-authenticated-shell.helpers';
import { browserPageRateLimitRouteOptions } from './browser-page-rate-limit.route';
import { renderBrowserProjectsPage } from './browser-projects.page';

export function registerBrowserProjectsRoute(app: ApiApp): void {
  app.get(browserOrganizationProjectsPathnameTemplate, browserPageRateLimitRouteOptions, handleBrowserProjects);
}

async function handleBrowserProjects(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  return await sendAuthenticatedBrowserShell(request, reply, renderBrowserProjectsPage);
}
