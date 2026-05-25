import { mkdirSync } from 'node:fs';
import fastifyStatic from '@fastify/static';
import { resolveCompartmentConsoleAssetDirectory } from '@compartment/console';
import type { FastifyPluginOptions } from 'fastify';
import type { ApiApp } from '../../app.types';
import { browserAssetsPathname } from '../../browser-public-paths';
import { addNoStoreCacheControlHeader } from '../../http/no-store-response-cache';
import { registerBrowserActivateRoute } from './browser-activate.route';
import { registerBrowserAuditRoute } from './browser-audit.route';
import { addBrowserAntiFramingHeaders } from './browser-anti-framing.hook';
import { registerBrowserGroupsRoute } from './browser-groups.route';
import { registerBrowserHomeRoute } from './browser-home.route';
import { registerBrowserLoginRoute } from './browser-login.route';
import { registerBrowserLogoutRoute } from './browser-logout.route';
import { registerBrowserOnboardingRoute } from './browser-onboarding.route';
import { registerBrowserProjectCreateRoute } from './browser-project-create.route';
import { registerBrowserProjectDeploymentsRoute } from './browser-project-deployments.route';
import { registerBrowserProjectOverviewRoute } from './browser-project-overview.route';
import { registerBrowserProjectsRoute } from './browser-projects.route';
import { registerBrowserResetPasswordRoute } from './browser-reset-password.route';
import { registerBrowserRolesRoute } from './browser-roles.route';
import { registerBrowserUsersRoute } from './browser-users.route';

type RegisterBrowserRoutesDone = (err?: Error) => void;

export async function registerBrowserRoutes(app: ApiApp): Promise<void> {
  app.addHook('onSend', addBrowserAntiFramingHeaders);
  await app.register(registerBrowserAssetRoutes);
  app.register(registerBrowserPageRoutes);
}

async function registerBrowserAssetRoutes(app: ApiApp): Promise<void> {
  await app.register(fastifyStatic, {
    prefix: browserAssetsPathname,
    root: ensureBrowserAssetDirectory(),
  });
}

function registerBrowserPageRoutes(app: ApiApp, _options: FastifyPluginOptions, done: RegisterBrowserRoutesDone): void {
  app.addHook('onSend', addNoStoreCacheControlHeader);
  registerBrowserPages(app);
  registerBrowserSessionRoutes(app);
  done();
}

function registerBrowserPages(app: ApiApp): void {
  registerBrowserHomeRoute(app);
  registerBrowserActivateRoute(app);
  registerBrowserAuditRoute(app);
  registerBrowserGroupsRoute(app);
  registerBrowserOnboardingRoute(app);
  registerBrowserProjectCreateRoute(app);
  registerBrowserProjectDeploymentsRoute(app);
  registerBrowserProjectOverviewRoute(app);
  registerBrowserProjectsRoute(app);
  registerBrowserRolesRoute(app);
  registerBrowserUsersRoute(app);
}

function registerBrowserSessionRoutes(app: ApiApp): void {
  registerBrowserLoginRoute(app);
  registerBrowserLogoutRoute(app);
  registerBrowserResetPasswordRoute(app);
}

function ensureBrowserAssetDirectory(): string {
  const browserAssetDirectory: string = resolveCompartmentConsoleAssetDirectory();
  mkdirSync(browserAssetDirectory, { recursive: true });

  return browserAssetDirectory;
}
