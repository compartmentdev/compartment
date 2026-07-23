import type { DeploymentPromotionStage } from '@compartment/contracts';
import { listDeploymentKubePhaseReferences, listDeploymentPhaseEvents } from '../queries/deployment-phase.query';
import type {
  DeploymentKubePhaseReference,
  DeploymentKubePhaseState,
  DeploymentPhaseEventRow,
} from '../queries/deployment-phase.query.types';
import type { DeploymentJoinedRow } from '../queries/deployments.query.types';
import { resolveObservedDeploymentPhase } from './deployment-phase.service.helpers';

export async function applyObservedDeploymentPhases(
  deployments: DeploymentJoinedRow[],
): Promise<DeploymentJoinedRow[]> {
  const references: DeploymentKubePhaseReference[] = await listDeploymentKubePhaseReferences(
    deployments.map((deployment: DeploymentJoinedRow): string => deployment.deployment.id),
  );
  const eventsByRun: ReadonlyMap<string, DeploymentPhaseEventRow[]> = await readEventsByRun(deployments);
  const stateByDeployment: ReadonlyMap<string, DeploymentKubePhaseState> = new Map(
    references.map((reference: DeploymentKubePhaseReference): [string, DeploymentKubePhaseState] => [
      reference.deploymentId,
      reference.state,
    ]),
  );
  return deployments.map(
    (deployment: DeploymentJoinedRow): DeploymentJoinedRow =>
      applyObservedDeploymentPhase(deployment, eventsByRun, stateByDeployment),
  );
}

async function readEventsByRun(
  deployments: DeploymentJoinedRow[],
): Promise<ReadonlyMap<string, DeploymentPhaseEventRow[]>> {
  const runIds: string[] = [
    ...new Set(deployments.map((deployment: DeploymentJoinedRow): string => deployment.deployment.deploymentRunId)),
  ];
  const events: DeploymentPhaseEventRow[] = await listDeploymentPhaseEvents(runIds);
  const eventsByRun: Map<string, DeploymentPhaseEventRow[]> = new Map<string, DeploymentPhaseEventRow[]>();
  for (const event of events) {
    const runEvents: DeploymentPhaseEventRow[] = eventsByRun.get(event.deploymentRunId) ?? [];
    runEvents.push(event);
    eventsByRun.set(event.deploymentRunId, runEvents);
  }
  return eventsByRun;
}

function applyObservedDeploymentPhase(
  deployment: DeploymentJoinedRow,
  eventsByRun: ReadonlyMap<string, DeploymentPhaseEventRow[]>,
  stateByDeployment: ReadonlyMap<string, DeploymentKubePhaseState>,
): DeploymentJoinedRow {
  const scopedEvents: DeploymentPhaseEventRow[] = readScopedEvents(deployment, eventsByRun);
  const promotionStage: DeploymentPromotionStage = resolveObservedDeploymentPhase({
    events: scopedEvents,
    kubeState: stateByDeployment.get(deployment.deployment.id) ?? null,
    operationType: deployment.operation.type,
    status: deployment.deployment.status,
    storedStage: deployment.deployment.promotionStage,
  });
  return {
    ...deployment,
    deployment: {
      ...deployment.deployment,
      failureMessage: readObservedFailureMessage(deployment, scopedEvents, promotionStage),
      promotionStage,
    },
  };
}

function readScopedEvents(
  deployment: DeploymentJoinedRow,
  eventsByRun: ReadonlyMap<string, DeploymentPhaseEventRow[]>,
): DeploymentPhaseEventRow[] {
  const events: DeploymentPhaseEventRow[] = eventsByRun.get(deployment.deployment.deploymentRunId) ?? [];
  return events.filter(
    (event: DeploymentPhaseEventRow): boolean =>
      event.deploymentId === null || event.deploymentId === deployment.deployment.id,
  );
}

function readObservedFailureMessage(
  deployment: DeploymentJoinedRow,
  events: DeploymentPhaseEventRow[],
  promotionStage: DeploymentPromotionStage,
): string | null {
  if (deployment.deployment.status !== 'failed' || deployment.deployment.failureMessage !== null) {
    return deployment.deployment.failureMessage;
  }
  const failedEvent: DeploymentPhaseEventRow | undefined = events.findLast(
    (event: DeploymentPhaseEventRow): boolean => event.status === 'failed',
  );
  return failedEvent?.message ?? `Deployment failed during ${promotionStage}.`;
}
