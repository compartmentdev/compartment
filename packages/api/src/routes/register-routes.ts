import type { FastifyPluginOptions } from 'fastify';
import type { ApiApp } from '../app.types';
import type { ApiConfig } from '../config';
import { addNoStoreCacheControlHeader } from '../http/no-store-response-cache';
import { registerGetActivateStateRoute } from './auth/get-activate-state.route';
import { registerGetLoginStateRoute } from './auth/get-login-state.route';
import { registerGetResetPasswordStateRoute } from './auth/get-reset-password-state.route';
import { registerPostActivateRoute } from './auth/post-activate.route';
import { registerPostCliExchangeRoute } from './auth/post-cli-exchange.route';
import { registerPostCliStartRoute } from './auth/post-cli-start.route';
import { registerPostCliStatusRoute } from './auth/post-cli-status.route';
import { registerPostLoginDiscoveryRoute } from './auth/post-login-discovery.route';
import { registerPostResetPasswordRoute } from './auth/post-reset-password.route';
import { registerPostSignupRoute } from './auth/post-signup.route';
import { registerBrowserRoutes } from './browser/register-browser-routes';
import { registerPostLoginRoute } from './auth/post-login.route';
import { registerGetHealthzRoute } from './health/get-healthz.route';
import { registerGetReadyzRoute } from './health/get-readyz.route';
import { registerPostInstallRoute } from './install/post-install.route';
import { registerInternalApiRoutes } from './internal/register-internal-routes';
import { registerProtectedApiRoutes } from './protected/register-protected-routes';
import { registerGitSourcePublicRoutes } from './sources/source-git-public.route';
import { registerSystemDomainProbeRoute } from './system-domain/register-system-domain-probe-route';

type RegisterRoutesDone = (err?: Error) => void;

interface InstallRoutesPluginOptions extends FastifyPluginOptions {
  installToken: string;
}

export function registerApiRoutes(app: ApiApp, config: ApiConfig, installToken: string): void {
  registerTopLevelRoutes(app, installToken);
  registerNestedRoutes(app, config);
}

function registerTopLevelRoutes(app: ApiApp, installToken: string): void {
  registerHealthRoutes(app);
  registerBrowserRoutesEntry(app);
  registerInstallRoutes(app, installToken);
  registerAuthRoutes(app);
  registerSourceRoutes(app);
  registerSystemRoutes(app);
}

function registerHealthRoutes(app: ApiApp): void {
  registerGetHealthzRoute(app);
  registerGetReadyzRoute(app);
}

function registerBrowserRoutesEntry(app: ApiApp): void {
  app.register(registerBrowserRoutes);
}

function registerInstallRoutes(app: ApiApp, installToken: string): void {
  app.register(registerInstallRoutesWithNoStore, { installToken });
}

function registerAuthRoutes(app: ApiApp): void {
  app.register(registerAuthRoutesWithNoStore);
}

function registerInstallRoutesWithNoStore(
  app: ApiApp,
  options: InstallRoutesPluginOptions,
  done: RegisterRoutesDone,
): void {
  app.addHook('onSend', addNoStoreCacheControlHeader);
  registerPostInstallRoute(app, options.installToken);
  done();
}

function registerAuthRoutesWithNoStore(app: ApiApp, _options: FastifyPluginOptions, done: RegisterRoutesDone): void {
  app.addHook('onSend', addNoStoreCacheControlHeader);
  registerGetActivateStateRoute(app);
  registerGetLoginStateRoute(app);
  registerGetResetPasswordStateRoute(app);
  registerPostActivateRoute(app);
  registerPostLoginDiscoveryRoute(app);
  registerPostLoginRoute(app);
  registerPostResetPasswordRoute(app);
  registerPostSignupRoute(app);
  registerCliLoginRoutes(app);
  done();
}

function registerCliLoginRoutes(app: ApiApp): void {
  registerPostCliStartRoute(app);
  registerPostCliStatusRoute(app);
  registerPostCliExchangeRoute(app);
}

function registerSourceRoutes(app: ApiApp): void {
  registerGitSourcePublicRoutes(app);
}

function registerSystemRoutes(app: ApiApp): void {
  registerSystemDomainProbeRoute(app);
}

function registerNestedRoutes(app: ApiApp, config: ApiConfig): void {
  app.register(registerInternalApiRoutes, {
    sourceArchiveMaxBytes: config.sourceArchiveMaxBytes,
  });
  app.register(registerProtectedApiRoutes);
}
