import {
  buildFastifyResponseSchemas,
  workerClaimProjectProvisioningV2Pathname,
  workerClaimProjectProvisioningV2RequestSchema,
  workerClaimProjectProvisioningV2ResponseSchema,
  type WorkerClaimProjectProvisioningV2Response,
  type WorkerClaimProjectProvisioningV2Request,
} from '@compartment/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiApp } from '../../app.types';
import { parseRequestValue } from '../../http/validation';
import { claimProjectProvisioningV2 } from '../../services/project-provisioning.service';
import type { ProjectProvisioningClaim } from '../../services/project-provisioning.service.types';
import { buildWorkerClaimProjectProvisioningV2Response } from './project-provisioning.presenter';

export function registerPostClaimProjectProvisioningRoute(app: ApiApp): void {
  app.post(
    workerClaimProjectProvisioningV2Pathname,
    { schema: { response: buildFastifyResponseSchemas({ 200: workerClaimProjectProvisioningV2ResponseSchema }) } },
    handlePostClaimProjectProvisioningV2,
  );
}

async function handlePostClaimProjectProvisioningV2(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<FastifyReply> {
  const input: WorkerClaimProjectProvisioningV2Request = parseRequestValue(
    workerClaimProjectProvisioningV2RequestSchema,
    request.body,
    'invalid_project_provisioning_claim',
  );
  const claim: ProjectProvisioningClaim = await claimProjectProvisioningV2(input.resourceConfigurationFingerprint);
  for (const projectId of claim.terminalFailureProjectIds) {
    request.log.error(
      { projectId },
      'Project Kubernetes teardown reached its terminal retry limit after the final lease expired.',
    );
  }
  const response: WorkerClaimProjectProvisioningV2Response = workerClaimProjectProvisioningV2ResponseSchema.parse(
    buildWorkerClaimProjectProvisioningV2Response(claim.target),
  );
  return await reply.send(response);
}
