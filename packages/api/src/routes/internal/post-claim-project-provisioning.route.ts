import {
  buildFastifyResponseSchemas,
  workerClaimProjectProvisioningPathname,
  workerClaimProjectProvisioningResponseSchema,
  workerClaimProjectProvisioningV2Pathname,
  workerClaimProjectProvisioningV2ResponseSchema,
  type WorkerClaimProjectProvisioningResponse,
  type WorkerClaimProjectProvisioningV2Response,
} from '@compartment/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiApp } from '../../app.types';
import { claimProjectProvisioning, claimProjectProvisioningV2 } from '../../services/project-provisioning.service';
import {
  buildWorkerClaimProjectProvisioningResponse,
  buildWorkerClaimProjectProvisioningV2Response,
} from './project-provisioning.presenter';

export function registerPostClaimProjectProvisioningRoute(app: ApiApp): void {
  app.post(
    workerClaimProjectProvisioningPathname,
    { schema: { response: buildFastifyResponseSchemas({ 200: workerClaimProjectProvisioningResponseSchema }) } },
    handlePostClaimProjectProvisioning,
  );
  app.post(
    workerClaimProjectProvisioningV2Pathname,
    { schema: { response: buildFastifyResponseSchemas({ 200: workerClaimProjectProvisioningV2ResponseSchema }) } },
    handlePostClaimProjectProvisioningV2,
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

async function handlePostClaimProjectProvisioningV2(
  _request: FastifyRequest,
  reply: FastifyReply,
): Promise<FastifyReply> {
  const response: WorkerClaimProjectProvisioningV2Response = workerClaimProjectProvisioningV2ResponseSchema.parse(
    buildWorkerClaimProjectProvisioningV2Response(await claimProjectProvisioningV2()),
  );
  return await reply.send(response);
}
