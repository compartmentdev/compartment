import type { DeploymentSummaryInput } from '../presenter.types';
import { recordAuditEvent } from '../audit-events.service';

export async function recordSourceDeploymentAuditEvents(
  deployments: DeploymentSummaryInput[],
  organizationId: string,
  principalId: string,
): Promise<void> {
  for (const deployment of deployments) {
    await recordSourceDeploymentAuditEvent(deployment, organizationId, principalId);
  }
}

async function recordSourceDeploymentAuditEvent(
  deployment: DeploymentSummaryInput,
  organizationId: string,
  principalId: string,
): Promise<void> {
  await recordAuditEvent({
    actor: { principalId, type: 'automation' },
    eventType: 'deployment.created',
    metadata: {
      accessMode: deployment.deployment.accessMode,
      deploymentRunId: deployment.deployment.deploymentRunId,
      serviceName: deployment.service.name,
    },
    organizationId,
    target: {
      displayName: deployment.service.name,
      environmentId: deployment.environment.id,
      id: deployment.deployment.id,
      projectId: deployment.project.id,
      serviceId: deployment.service.id,
      type: 'deployment',
    },
  });
}
