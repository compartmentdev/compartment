import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiApp } from '../../app.types';
import {
  browserOrganizationProjectDeploymentDetailsPathnameTemplate,
  browserOrganizationProjectDeploymentsPathnameTemplate,
} from '../../browser-public-paths';
import { sendAuthenticatedBrowserShell } from './browser-authenticated-shell.helpers';
import { browserPageRateLimitRouteOptions } from './browser-page-rate-limit.route';
import { renderBrowserProjectDeploymentsPage } from './browser-project-deployments.page';

export function registerBrowserProjectDeploymentsRoute(app: ApiApp): void {
  app.get(
    browserOrganizationProjectDeploymentsPathnameTemplate,
    browserPageRateLimitRouteOptions,
    handleBrowserProjectDeployments,
  );
  app.get(
    browserOrganizationProjectDeploymentDetailsPathnameTemplate,
    browserPageRateLimitRouteOptions,
    handleBrowserProjectDeployments,
  );
}

async function handleBrowserProjectDeployments(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  return await sendAuthenticatedBrowserShell(request, reply, renderBrowserProjectDeploymentsPage);
}
