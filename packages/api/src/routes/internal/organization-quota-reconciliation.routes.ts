import {
  buildFastifyResponseSchemas,
  workerClaimOrganizationQuotaReconcilePathname,
  workerClaimOrganizationQuotaReconcileResponseSchema,
  workerCompleteOrganizationQuotaReconcilePathname,
  workerCompleteOrganizationQuotaReconcileRequestSchema,
  workerCompleteOrganizationQuotaReconcileResponseSchema,
  type OrganizationQuotaReconcileTarget,
  type WorkerClaimOrganizationQuotaReconcileResponse,
  type WorkerCompleteOrganizationQuotaReconcileRequest,
  type WorkerCompleteOrganizationQuotaReconcileResponse,
} from '@compartment/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiApp } from '../../app.types';
import { parseRequestValue } from '../../http/validation';
import {
  acknowledgeOrganizationQuotaReconciliation,
  claimNextOrganizationQuotaReconciliation,
} from '../../services/organization-quota-reconciliation.service';
import {
  buildWorkerClaimOrganizationQuotaReconcileResponse,
  buildWorkerCompleteOrganizationQuotaReconcileResponse,
} from './organization-quota-reconciliation.presenter';

export function registerOrganizationQuotaReconciliationRoutes(app: ApiApp): void {
  app.post(
    workerClaimOrganizationQuotaReconcilePathname,
    { schema: { response: buildFastifyResponseSchemas({ 200: workerClaimOrganizationQuotaReconcileResponseSchema }) } },
    handleClaimOrganizationQuotaReconciliation,
  );
  app.post(
    workerCompleteOrganizationQuotaReconcilePathname,
    {
      schema: {
        response: buildFastifyResponseSchemas({ 200: workerCompleteOrganizationQuotaReconcileResponseSchema }),
      },
    },
    handleCompleteOrganizationQuotaReconciliation,
  );
}

async function handleClaimOrganizationQuotaReconciliation(
  _request: FastifyRequest,
  reply: FastifyReply,
): Promise<FastifyReply> {
  const target: OrganizationQuotaReconcileTarget | null = await claimNextOrganizationQuotaReconciliation();
  const response: WorkerClaimOrganizationQuotaReconcileResponse =
    buildWorkerClaimOrganizationQuotaReconcileResponse(target);
  return await reply.send(workerClaimOrganizationQuotaReconcileResponseSchema.parse(response));
}

async function handleCompleteOrganizationQuotaReconciliation(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<FastifyReply> {
  const input: WorkerCompleteOrganizationQuotaReconcileRequest = parseRequestValue(
    workerCompleteOrganizationQuotaReconcileRequestSchema,
    request.body,
    'invalid_organization_quota_reconciliation_completion',
  );
  const applied: boolean = await acknowledgeOrganizationQuotaReconciliation({
    failureMessage: input.message ?? null,
    leaseId: input.leaseId,
    organizationId: input.organizationId,
    status: input.status,
  });
  const response: WorkerCompleteOrganizationQuotaReconcileResponse =
    buildWorkerCompleteOrganizationQuotaReconcileResponse(applied);
  return await reply.send(workerCompleteOrganizationQuotaReconcileResponseSchema.parse(response));
}
