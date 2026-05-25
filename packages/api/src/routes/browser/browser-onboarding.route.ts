import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiApp } from '../../app.types';
import { browserOrganizationOnboardingPathnameTemplate } from '../../browser-public-paths';
import { sendAuthenticatedBrowserShell } from './browser-authenticated-shell.helpers';
import { renderBrowserOnboardingPage } from './browser-onboarding.page';
import { browserPageRateLimitRouteOptions } from './browser-page-rate-limit.route';

export function registerBrowserOnboardingRoute(app: ApiApp): void {
  app.get(browserOrganizationOnboardingPathnameTemplate, browserPageRateLimitRouteOptions, handleBrowserOnboarding);
}

async function handleBrowserOnboarding(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  return await sendAuthenticatedBrowserShell(request, reply, renderBrowserOnboardingPage);
}
