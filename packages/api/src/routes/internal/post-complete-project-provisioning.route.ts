import {
  buildFastifyResponseSchemas,
  workerCompleteProjectProvisioningPathname,
  workerCompleteProjectProvisioningRequestSchema,
  workerCompleteProjectProvisioningResponseSchema,
  type WorkerCompleteProjectProvisioningRequest,
  type WorkerCompleteProjectProvisioningResponse,
} from '@compartment/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiApp } from '../../app.types';
import { parseRequestValue } from '../../http/validation';
import { acknowledgeProjectProvisioning } from '../../services/project-provisioning.service';
import { buildWorkerCompleteProjectProvisioningResponse } from './project-provisioning.presenter';

export function registerPostCompleteProjectProvisioningRoute(app: ApiApp): void {
  app.post(
    workerCompleteProjectProvisioningPathname,
    { schema: { response: buildFastifyResponseSchemas({ 200: workerCompleteProjectProvisioningResponseSchema }) } },
    handlePostCompleteProjectProvisioning,
  );
}

async function handlePostCompleteProjectProvisioning(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<FastifyReply> {
  const input: WorkerCompleteProjectProvisioningRequest = parseRequestValue(
    workerCompleteProjectProvisioningRequestSchema,
    request.body,
    'invalid_project_provisioning_completion',
  );
  const response: WorkerCompleteProjectProvisioningResponse = workerCompleteProjectProvisioningResponseSchema.parse(
    buildWorkerCompleteProjectProvisioningResponse(await acknowledgeProjectProvisioning(input)),
  );
  return await reply.send(response);
}
