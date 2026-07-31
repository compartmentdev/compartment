import {
  buildFastifyResponseSchemas,
  type FastifyResponseSchemas,
  workerClaimDeploymentRequestSchema,
  workerClaimDeploymentResponseSchema,
  workerClaimNextDeploymentPathname,
  type WorkerClaimDeploymentRequest,
  type WorkerClaimDeploymentResponse,
} from '@compartment/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiApp } from '../../app.types';
import { parseRequestValue } from '../../http/validation';
import { claimQueuedDeploymentForWorker } from '../../services/deployment-worker.service';
import { buildWorkerClaimDeploymentResponse } from './worker-claim.presenter';

const workerClaimSchedulerPolicy: string = 'project_least_active_fifo_v1';

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
  const input: WorkerClaimDeploymentRequest = parseRequestValue(
    workerClaimDeploymentRequestSchema,
    request.body,
    'invalid_worker_claim_deployment_request',
  );
  const response: WorkerClaimDeploymentResponse = workerClaimDeploymentResponseSchema.parse(
    buildWorkerClaimDeploymentResponse(await claimQueuedDeploymentForWorker(input)),
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
