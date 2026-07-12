import type { FastifyPluginOptions } from 'fastify';
import type { ApiApp } from '../../app.types';
import { authenticateInternalEdgeRequest } from './authenticate-internal-edge-request';
import { authenticateInternalWorkerRequest } from './authenticate-internal-worker-request';
import { registerGetAppAccessStateRoute } from './get-app-access-state.route';
import { registerGetArtifactSourceArchiveRoute } from './get-artifact-source-archive.route';
import { registerPostAppAccessExchangeRoute } from './post-app-access-exchange.route';
import { registerPostAppAccessLogoutRoute } from './post-app-access-logout.route';
import { registerPostClaimDeploymentRoute } from './post-claim-deployment.route';
import { registerPostClaimGitSourceResolutionTaskRoute } from './post-claim-git-source-resolution-task.route';
import { registerPostClaimGitSourceSyncTaskRoute } from './post-claim-git-source-sync-task.route';
import { registerPostCompleteDeploymentRoute } from './post-complete-deployment.route';
import { registerPostCompleteGitSourceResolutionTaskRoute } from './post-complete-git-source-resolution-task.route';
import { registerPostCompleteGitSourceSyncTaskRoute } from './post-complete-git-source-sync-task.route';
import { registerPostDeploymentRuntimeEventRoute } from './post-deployment-runtime-event.route';
import { registerPostNodeRegisterRoute } from './post-node-register.route';
import { registerPostDeploymentRuntimeStateRoute } from './post-deployment-runtime-state.route';
import { registerPostFailDeploymentRoute } from './post-fail-deployment.route';
import { registerPostFailGitSourceResolutionTaskRoute } from './post-fail-git-source-resolution-task.route';
import { registerPostFailGitSourceSyncTaskRoute } from './post-fail-git-source-sync-task.route';
import { registerPostRecoverRunningDeploymentsRoute } from './post-recover-running-deployments.route';
import { registerPostRunNextScheduledResourceOperationRoute } from './post-run-next-scheduled-resource-operation.route';
import { registerPostUploadGitSourceResolutionTaskArchiveRoute } from './post-upload-git-source-resolution-task-archive.route';
import { registerProductJobRoutes } from './product-job.routes';

type RegisterInternalRoutesDone = (err?: Error) => void;
interface InternalApiRoutesOptions extends FastifyPluginOptions {
  nodeAgentSocketPath: string;
  sourceArchiveMaxBytes: number;
}

export function registerInternalApiRoutes(
  app: ApiApp,
  options: InternalApiRoutesOptions,
  done: RegisterInternalRoutesDone,
): void {
  app.register(registerEdgeInternalRoutes);
  app.register(registerWorkerInternalRoutes, options);
  done();
}

function registerEdgeInternalRoutes(
  app: ApiApp,
  _options: FastifyPluginOptions,
  done: RegisterInternalRoutesDone,
): void {
  app.addHook('preHandler', authenticateInternalEdgeRequest);
  registerGetAppAccessStateRoute(app);
  registerPostAppAccessExchangeRoute(app);
  registerPostAppAccessLogoutRoute(app);
  done();
}

function registerWorkerInternalRoutes(
  app: ApiApp,
  options: InternalApiRoutesOptions,
  done: RegisterInternalRoutesDone,
): void {
  app.addHook('preHandler', authenticateInternalWorkerRequest);
  registerPostNodeRegisterRoute(app, options.nodeAgentSocketPath);
  registerGetArtifactSourceArchiveRoute(app);
  registerPostRecoverRunningDeploymentsRoute(app);
  registerPostClaimDeploymentRoute(app);
  registerPostCompleteDeploymentRoute(app);
  registerPostDeploymentRuntimeStateRoute(app);
  registerPostDeploymentRuntimeEventRoute(app);
  registerPostFailDeploymentRoute(app);
  registerWorkerOperationRoutes(app);
  registerGitSourceResolutionWorkerRoutes(app, options.sourceArchiveMaxBytes);
  done();
}

function registerWorkerOperationRoutes(app: ApiApp): void {
  registerPostRunNextScheduledResourceOperationRoute(app);
  registerProductJobRoutes(app);
}

function registerGitSourceResolutionWorkerRoutes(app: ApiApp, sourceArchiveMaxBytes: number): void {
  registerPostClaimGitSourceResolutionTaskRoute(app);
  registerPostUploadGitSourceResolutionTaskArchiveRoute(app, sourceArchiveMaxBytes);
  registerPostCompleteGitSourceResolutionTaskRoute(app);
  registerPostFailGitSourceResolutionTaskRoute(app);
  registerPostClaimGitSourceSyncTaskRoute(app);
  registerPostCompleteGitSourceSyncTaskRoute(app);
  registerPostFailGitSourceSyncTaskRoute(app);
}
