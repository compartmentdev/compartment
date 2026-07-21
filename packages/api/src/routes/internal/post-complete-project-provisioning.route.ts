import {
  buildFastifyResponseSchemas,
  workerCompleteProjectProvisioningResponseSchema,
  workerCompleteProjectProvisioningV2Pathname,
  workerCompleteProjectProvisioningV2RequestSchema,
  type WorkerCompleteProjectProvisioningResponse,
  type WorkerCompleteProjectProvisioningV2Request,
} from '@compartment/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiApp } from '../../app.types';
import { parseRequestValue } from '../../http/validation';
import { acknowledgeProjectProvisioningV2 } from '../../services/project-provisioning.service';
import type { ProjectProvisioningAcknowledgement } from '../../services/project-provisioning.service.types';
import { buildWorkerCompleteProjectProvisioningResponse } from './project-provisioning.presenter';

export function registerPostCompleteProjectProvisioningRoute(app: ApiApp): void {
  app.post(
    workerCompleteProjectProvisioningV2Pathname,
    { schema: { response: buildFastifyResponseSchemas({ 200: workerCompleteProjectProvisioningResponseSchema }) } },
    handlePostCompleteProjectProvisioningV2,
  );
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
  const acknowledgement: ProjectProvisioningAcknowledgement = await acknowledgeProjectProvisioningV2(input);
  if (acknowledgement.terminalFailure) {
    request.log.error(
      { failureMessage: input.message, projectId: input.projectId },
      'Project Kubernetes teardown reached its terminal retry limit.',
    );
  }
  const response: WorkerCompleteProjectProvisioningResponse = workerCompleteProjectProvisioningResponseSchema.parse(
    buildWorkerCompleteProjectProvisioningResponse(acknowledgement.applied),
  );
  return await reply.send(response);
}
