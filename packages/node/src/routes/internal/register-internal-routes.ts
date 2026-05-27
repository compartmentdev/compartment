import type { FastifyPluginOptions } from 'fastify';
import type { NodeApp } from '../../app.types';
import type { NodeConfig } from '../../config';
import type { RegisterNodeInternalRoutesDone } from './internal-routes.types';
import { createAuthenticateInternalRequest } from './authenticate-internal-request';
import { registerGetRuntimeInspectRoute } from './get-runtime-inspect.route';
import { registerGetRuntimeLogsRoute } from './get-runtime-logs.route';
import { registerPostRuntimeDeployRoute } from './post-runtime-deploy.route';
import { registerPostRuntimeDrainRoute } from './post-runtime-drain.route';
import { registerPostRuntimeNetworkReconcileRoute } from './post-runtime-network-reconcile.route';
import { registerPostRuntimeReleaseRoute } from './post-runtime-release.route';
import { registerPostRuntimeStopRoute } from './post-runtime-stop.route';
import { registerPostProjectCleanupRoute } from './post-project-cleanup.route';
import { registerResourceRoutes } from './resource-routes';

export function registerInternalNodeRoutes(app: NodeApp, config: NodeConfig): void {
  app.register(function registerInternalNodeRoutesPlugin(
    internalApp: NodeApp,
    _options: FastifyPluginOptions,
    done: RegisterNodeInternalRoutesDone,
  ): void {
    internalApp.addHook('preHandler', createAuthenticateInternalRequest(config));
    registerPostRuntimeDeployRoute(internalApp, config);
    registerPostRuntimeDrainRoute(internalApp, config);
    registerPostRuntimeNetworkReconcileRoute(internalApp, config);
    registerPostRuntimeReleaseRoute(internalApp, config);
    registerGetRuntimeInspectRoute(internalApp, config);
    registerPostRuntimeStopRoute(internalApp, config);
    registerPostProjectCleanupRoute(internalApp, config);
    registerGetRuntimeLogsRoute(internalApp);
    registerResourceRoutes(internalApp, config);
    done();
  });
}
