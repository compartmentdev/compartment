import type {
  AuditEventType,
  AuditEventMetadata,
  DeployResponse,
  ResourceBackupCreateResponse,
  ResourceResponse,
  ResourceSummary,
  ResourceRestoreAsResponse,
  ResourceRestoreResponse,
} from '@compartment/contracts';
import type { FastifyRequest } from 'fastify';
import '../../http/request.types';
import { recordAuditEvent } from '../../services/audit-events.service';
import type { AuditEventTargetInput } from '../../services/audit-events.service.types';
import type { DeploymentSummaryInput } from '../../services/presenter.types';
import { buildAuditEventForRequest } from './audit-event-route-context';

export async function recordDeploymentAuditEvents(
  request: FastifyRequest,
  response: DeployResponse,
  eventType: 'deployment.created' | 'deployment.rolled_back',
  candidates: readonly DeploymentSummaryInput[],
): Promise<void> {
  for (const deployment of response.deployments) {
    const target: AuditEventTargetInput = buildDeploymentTarget(
      response,
      deployment.id,
      deployment.serviceName,
      requireDeploymentServiceId(candidates, deployment.id),
    );
    const accessMode: string = deployment.accessProtected === false ? 'public' : 'authenticated';
    await recordRequestAuditEvent(request, eventType, target, {
      accessMode,
      deploymentRunId: response.deploymentRunId,
      serviceName: deployment.serviceName,
    });
  }
}

export async function recordResourceAuditEvent(
  request: FastifyRequest,
  response: ResourceResponse,
  eventType: 'resource.bootstrapped' | 'resource.started' | 'resource.stopped',
): Promise<void> {
  await recordRequestAuditEvent(request, eventType, buildResourceTarget(response), {});
}

export async function recordResourceDeletedAuditEvent(
  request: FastifyRequest,
  response: ResourceResponse,
  deletedData: boolean,
): Promise<void> {
  await recordRequestAuditEvent(request, 'resource.deleted', buildResourceTarget(response), { deletedData });
}

export async function recordResourceBackupCreatedAuditEvent(
  request: FastifyRequest,
  response: ResourceBackupCreateResponse,
): Promise<void> {
  await recordRequestAuditEvent(request, 'resource.backup.created', buildResourceTarget(response), {
    backupId: response.backup.id,
    purpose: response.backup.purpose,
  });
}

export async function recordResourceBackupRestoredAuditEvent(
  request: FastifyRequest,
  response: ResourceRestoreResponse | ResourceRestoreAsResponse,
): Promise<void> {
  await recordRequestAuditEvent(request, 'resource.backup.restored', buildResourceTarget(response), {
    backupId: response.restoredBackup.id,
  });
}

async function recordRequestAuditEvent(
  request: FastifyRequest,
  eventType: AuditEventType,
  target: AuditEventTargetInput,
  metadata: AuditEventMetadata,
): Promise<void> {
  await recordAuditEvent(buildAuditEventForRequest(request, { eventType, metadata, target }));
}

function buildResourceTarget(
  response: ResourceResponse | ResourceBackupCreateResponse | ResourceRestoreResponse | ResourceRestoreAsResponse,
): AuditEventTargetInput {
  const resource: ResourceSummary = 'backup' in response ? response.backup.resource : response.resource;

  return {
    displayName: resource.name,
    environmentId: response.environment.id,
    id: resource.id,
    projectId: response.project.id,
    type: 'resource',
  };
}

function buildDeploymentTarget(
  response: DeployResponse,
  id: string,
  serviceName: string,
  serviceId: string,
): AuditEventTargetInput {
  return {
    displayName: serviceName,
    environmentId: response.environment.id,
    id,
    projectId: response.project.id,
    serviceId,
    type: 'deployment',
  };
}

function requireDeploymentServiceId(candidates: readonly DeploymentSummaryInput[], deploymentId: string): string {
  const candidate: DeploymentSummaryInput | undefined = candidates.find(
    (item: DeploymentSummaryInput): boolean => item.deployment.id === deploymentId,
  );
  if (candidate === undefined) {
    throw new Error(`Expected deployment audit candidate ${deploymentId}.`);
  }

  return candidate.service.id;
}
