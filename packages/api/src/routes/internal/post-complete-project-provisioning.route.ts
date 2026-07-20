import {
  buildFastifyResponseSchemas,
  workerCompleteProjectProvisioningPathname,
  workerCompleteProjectProvisioningRequestSchema,
  workerCompleteProjectProvisioningResponseSchema,
  workerCompleteProjectProvisioningV2Pathname,
  workerCompleteProjectProvisioningV2RequestSchema,
  type WorkerCompleteProjectProvisioningRequest,
  type WorkerCompleteProjectProvisioningResponse,
  type WorkerCompleteProjectProvisioningV2Request,
} from '@compartment/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiApp } from '../../app.types';
import { parseRequestValue } from '../../http/validation';
import {
  acknowledgeProjectProvisioning,
  acknowledgeProjectProvisioningV2,
} from '../../services/project-provisioning.service';
import { buildWorkerCompleteProjectProvisioningResponse } from './project-provisioning.presenter';

export function registerPostCompleteProjectProvisioningRoute(app: ApiApp): void {
  app.post(
    workerCompleteProjectProvisioningPathname,
    { schema: { response: buildFastifyResponseSchemas({ 200: workerCompleteProjectProvisioningResponseSchema }) } },
    handlePostCompleteProjectProvisioning,
  );
  app.post(
    workerCompleteProjectProvisioningV2Pathname,
    { schema: { response: buildFastifyResponseSchemas({ 200: workerCompleteProjectProvisioningResponseSchema }) } },
    handlePostCompleteProjectProvisioningV2,
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

async function handlePostCompleteProjectProvisioningV2(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<FastifyReply> {
  const input: WorkerCompleteProjectProvisioningV2Request = parseRequestValue(
    workerCompleteProjectProvisioningV2RequestSchema,
    request.body,
    'invalid_project_provisioning_completion',
  );
  const response: WorkerCompleteProjectProvisioningResponse = workerCompleteProjectProvisioningResponseSchema.parse(
    buildWorkerCompleteProjectProvisioningResponse(await acknowledgeProjectProvisioningV2(input)),
  );
  return await reply.send(response);
}
