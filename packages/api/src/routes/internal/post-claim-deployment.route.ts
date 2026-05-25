import {
  buildFastifyResponseSchemas,
  type FastifyResponseSchemas,
  workerClaimDeploymentResponseSchema,
  workerClaimNextDeploymentPathname,
  type WorkerClaimDeploymentResponse,
} from '@compartment/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiApp } from '../../app.types';
import { claimQueuedDeploymentForWorker } from '../../services/deployment-worker.service';
import { buildWorkerClaimDeploymentResponse } from './worker-claim.presenter';

const workerClaimSchedulerPolicy: string = 'org_round_robin_v1';

interface ClaimDeploymentRouteOptions {
  schema: {
    response: FastifyResponseSchemas;
  };
}

export function registerPostClaimDeploymentRoute(app: ApiApp): void {
  app.post(workerClaimNextDeploymentPathname, claimDeploymentRouteOptions, handlePostClaimDeployment);
}

const claimDeploymentRouteOptions: ClaimDeploymentRouteOptions = {
  schema: {
    response: buildFastifyResponseSchemas({
      200: workerClaimDeploymentResponseSchema,
    }),
  },
};

async function handlePostClaimDeployment(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const response: WorkerClaimDeploymentResponse = workerClaimDeploymentResponseSchema.parse(
    buildWorkerClaimDeploymentResponse(await claimQueuedDeploymentForWorker()),
  );
  if (response.deployment !== null) {
    request.log.info(
      {
        deploymentId: response.deployment.deploymentId,
        environmentId: response.deployment.environmentId,
        projectId: response.deployment.projectId,
        schedulerPolicy: workerClaimSchedulerPolicy,
      },
      'Claimed queued deployment for worker.',
    );
  }

  return await reply.send(response);
}
