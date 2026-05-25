import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiApp } from '../../app.types';
import {
  browserOrganizationProjectCreatePathnameTemplate,
  browserProjectCreatePathname,
} from '../../browser-public-paths';
import { sendAuthenticatedBrowserShell } from './browser-authenticated-shell.helpers';
import { renderBrowserProjectCreatePage } from './browser-project-create.page';
import { browserPageRateLimitRouteOptions } from './browser-page-rate-limit.route';

export function registerBrowserProjectCreateRoute(app: ApiApp): void {
  app.get(
    browserOrganizationProjectCreatePathnameTemplate,
    browserPageRateLimitRouteOptions,
    handleBrowserProjectCreate,
  );
  app.get(browserProjectCreatePathname, browserPageRateLimitRouteOptions, handleBrowserProjectCreate);
}

async function handleBrowserProjectCreate(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  return await sendAuthenticatedBrowserShell(request, reply, renderBrowserProjectCreatePage);
}
