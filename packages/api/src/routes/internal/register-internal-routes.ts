import type { FastifyPluginOptions } from 'fastify';
import type { ApiApp } from '../../app.types';
import { authenticateInternalEdgeRequest } from './authenticate-internal-edge-request';
import { authenticateInternalWorkerRequest } from './authenticate-internal-worker-request';
import { authenticateProductLogIngestRequest } from './authenticate-product-log-ingest-request';
import { registerGetAppAccessStateRoute } from './get-app-access-state.route';
import { registerGetArtifactSourceArchiveRoute } from './get-artifact-source-archive.route';
import { registerGetPodMetricNamespacesRoute } from './get-pod-metric-namespaces.route';
import { registerPostAppAccessExchangeRoute } from './post-app-access-exchange.route';
import { registerPostAppAccessLogoutRoute } from './post-app-access-logout.route';
import { registerPostClaimDeploymentRoute } from './post-claim-deployment.route';
import { registerPostRecoverOrphanedBuildClaimsRoute } from './post-recover-orphaned-build-claims.route';
import { registerPostClaimGitSourceResolutionTaskRoute } from './post-claim-git-source-resolution-task.route';
import { registerPostClaimGitSourceSyncTaskRoute } from './post-claim-git-source-sync-task.route';
import { registerPostCompleteGitSourceResolutionTaskRoute } from './post-complete-git-source-resolution-task.route';
import { registerPostCompleteGitSourceSyncTaskRoute } from './post-complete-git-source-sync-task.route';
import { registerPostDeploymentRuntimeEventRoute } from './post-deployment-runtime-event.route';
import { registerPostFailDeploymentRoute } from './post-fail-deployment.route';
import { registerPostFailGitSourceResolutionTaskRoute } from './post-fail-git-source-resolution-task.route';
import { registerPostFailGitSourceSyncTaskRoute } from './post-fail-git-source-sync-task.route';
import { registerPostRunNextScheduledResourceOperationRoute } from './post-run-next-scheduled-resource-operation.route';
import { registerPostUploadGitSourceResolutionTaskArchiveRoute } from './post-upload-git-source-resolution-task-archive.route';
import { registerPostProductLogsRoute } from './post-product-logs.route';
import { registerPostPodMetricsRoute } from './post-pod-metrics.route';
import { registerProductJobRoutes } from './product-job.routes';
import { registerDeploymentReconcileRoutes } from './deployment-reconcile.routes';
import { registerResourceReconcileRoutes } from './resource-reconcile.routes';
import { registerPostClaimProjectProvisioningRoute } from './post-claim-project-provisioning.route';
import { registerPostCompleteProjectProvisioningRoute } from './post-complete-project-provisioning.route';
import { registerCustomDomainReconcileRoutes } from './custom-domain-reconcile.routes';

type RegisterInternalRoutesDone = (err?: Error) => void;
interface InternalApiRoutesOptions extends FastifyPluginOptions {
  sourceArchiveMaxBytes: number;
}

export function registerInternalApiRoutes(
  app: ApiApp,
  options: InternalApiRoutesOptions,
  done: RegisterInternalRoutesDone,
): void {
  app.register(registerEdgeInternalRoutes);
  app.register(registerProductLogInternalRoutes);
  app.register(registerWorkerInternalRoutes, options);
  done();
}

function registerProductLogInternalRoutes(
  app: ApiApp,
  _options: FastifyPluginOptions,
  done: RegisterInternalRoutesDone,
): void {
  app.addHook('preHandler', authenticateProductLogIngestRequest);
  registerPostProductLogsRoute(app);
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
  registerGetArtifactSourceArchiveRoute(app);
  registerGetPodMetricNamespacesRoute(app);
  registerPostClaimDeploymentRoute(app);
  registerPostRecoverOrphanedBuildClaimsRoute(app);
  registerPostDeploymentRuntimeEventRoute(app);
  registerPostPodMetricsRoute(app);
  registerPostFailDeploymentRoute(app);
  registerWorkerOperationRoutes(app);
  registerGitSourceResolutionWorkerRoutes(app, options.sourceArchiveMaxBytes);
  done();
}

function registerWorkerOperationRoutes(app: ApiApp): void {
  registerPostClaimProjectProvisioningRoute(app);
  registerPostCompleteProjectProvisioningRoute(app);
  registerDeploymentReconcileRoutes(app);
  registerPostRunNextScheduledResourceOperationRoute(app);
  registerProductJobRoutes(app);
  registerResourceReconcileRoutes(app);
  registerCustomDomainReconcileRoutes(app);
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
