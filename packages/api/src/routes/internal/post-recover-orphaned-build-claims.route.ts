import {
  buildFastifyResponseSchemas,
  workerRecoverOrphanedBuildClaimsPathname,
  workerRecoverOrphanedBuildClaimsResponseSchema,
  type WorkerRecoverOrphanedBuildClaimsResponse,
} from '@compartment/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiApp } from '../../app.types';
import { recoverOrphanedDeploymentBuildClaims } from '../../services/deployment-worker.service';

export function registerPostRecoverOrphanedBuildClaimsRoute(app: ApiApp): void {
  app.post(
    workerRecoverOrphanedBuildClaimsPathname,
    { schema: { response: buildFastifyResponseSchemas({ 200: workerRecoverOrphanedBuildClaimsResponseSchema }) } },
    async (_request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
      const response: WorkerRecoverOrphanedBuildClaimsResponse = {
        requeuedDeploymentCount: await recoverOrphanedDeploymentBuildClaims(),
      };
      return await reply.send(workerRecoverOrphanedBuildClaimsResponseSchema.parse(response));
    },
  );
}
