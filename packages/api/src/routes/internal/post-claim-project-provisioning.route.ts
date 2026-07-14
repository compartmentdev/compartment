import {
  buildFastifyResponseSchemas,
  workerClaimProjectProvisioningPathname,
  workerClaimProjectProvisioningResponseSchema,
  type WorkerClaimProjectProvisioningResponse,
} from '@compartment/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiApp } from '../../app.types';
import { claimProjectProvisioning } from '../../services/project-provisioning.service';
import { buildWorkerClaimProjectProvisioningResponse } from './project-provisioning.presenter';

export function registerPostClaimProjectProvisioningRoute(app: ApiApp): void {
  app.post(
    workerClaimProjectProvisioningPathname,
    { schema: { response: buildFastifyResponseSchemas({ 200: workerClaimProjectProvisioningResponseSchema }) } },
    handlePostClaimProjectProvisioning,
  );
}

async function handlePostClaimProjectProvisioning(
  _request: FastifyRequest,
  reply: FastifyReply,
): Promise<FastifyReply> {
  const response: WorkerClaimProjectProvisioningResponse = workerClaimProjectProvisioningResponseSchema.parse(
    buildWorkerClaimProjectProvisioningResponse(await claimProjectProvisioning()),
  );
  return await reply.send(response);
}
