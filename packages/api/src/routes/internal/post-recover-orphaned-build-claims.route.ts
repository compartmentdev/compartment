import {
  buildFastifyResponseSchemas,
  workerRecoverOrphanedBuildClaimsPathname,
  workerRecoverOrphanedBuildClaimsRequestSchema,
  workerRecoverOrphanedBuildClaimsResponseSchema,
  type WorkerRecoverOrphanedBuildClaimsRequest,
  type WorkerRecoverOrphanedBuildClaimsResponse,
} from '@compartment/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiApp } from '../../app.types';
import { parseRequestValue } from '../../http/validation';
import { recoverOrphanedDeploymentBuildClaims } from '../../services/deployment-worker.service';

export function registerPostRecoverOrphanedBuildClaimsRoute(app: ApiApp): void {
  app.post(
    workerRecoverOrphanedBuildClaimsPathname,
    { schema: { response: buildFastifyResponseSchemas({ 200: workerRecoverOrphanedBuildClaimsResponseSchema }) } },
    async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
      const input: WorkerRecoverOrphanedBuildClaimsRequest = parseRequestValue(
        workerRecoverOrphanedBuildClaimsRequestSchema,
        request.body,
        'invalid_worker_recover_build_claims_request',
      );
      const response: WorkerRecoverOrphanedBuildClaimsResponse = {
        requeuedDeploymentCount: await recoverOrphanedDeploymentBuildClaims(input.claimTimeoutMs),
      };
      return await reply.send(workerRecoverOrphanedBuildClaimsResponseSchema.parse(response));
    },
  );
}
