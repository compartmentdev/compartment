import type { DeploymentPromotionStage, DeploymentRunStepKey } from '@compartment/contracts';
import type { DeploymentPhaseEvent, ObservedDeploymentPhaseInput } from './deployment-phase.service.types';

type ObservableDeploymentRunStepKey = Exclude<DeploymentRunStepKey, 'completed'>;

export function resolveObservedDeploymentPhase(input: ObservedDeploymentPhaseInput): DeploymentPromotionStage {
  const directPhase: DeploymentPromotionStage | null = resolveDirectPhase(input);
  if (directPhase !== null) {
    return directPhase;
  }
  const terminalEvent: DeploymentPhaseEvent | undefined = readTerminalFailureEvent(input.events);
  const latestStageEvent: (DeploymentPhaseEvent & { stepKey: ObservableDeploymentRunStepKey }) | undefined =
    readLatestStageEvent(input.events, terminalEvent);
  if (terminalEvent !== undefined && latestStageEvent?.status === 'succeeded') {
    return 'kube_apply';
  }
  return latestStageEvent === undefined ? 'queued' : mapStepToPhase(latestStageEvent.stepKey);
}

function resolveDirectPhase(input: ObservedDeploymentPhaseInput): DeploymentPromotionStage | null {
  if (input.status === 'stopped') {
    return 'stopped';
  }
  if (input.status === 'succeeded') {
    return input.storedStage;
  }
  if (input.operationType === 'deployment.rollback') {
    return input.kubeState === 'pending' || input.kubeState === 'active' ? 'activating' : 'restoring';
  }
  if (input.kubeState === 'pending') {
    return 'awaiting_readiness';
  }
  if (input.kubeState === 'desired') {
    return 'kube_apply';
  }
  return null;
}

function readTerminalFailureEvent(events: DeploymentPhaseEvent[]): DeploymentPhaseEvent | undefined {
  return events.findLast(
    (event: DeploymentPhaseEvent): boolean => event.stepKey === 'completed' && event.status === 'failed',
  );
}

function readLatestStageEvent(
  events: DeploymentPhaseEvent[],
  terminalEvent: DeploymentPhaseEvent | undefined,
): (DeploymentPhaseEvent & { stepKey: ObservableDeploymentRunStepKey }) | undefined {
  const phaseEvents: DeploymentPhaseEvent[] =
    terminalEvent === undefined
      ? events
      : events.filter((event: DeploymentPhaseEvent): boolean => event.createdAt <= terminalEvent.createdAt);
  return phaseEvents.findLast(isObservableDeploymentPhaseEvent);
}

function isObservableDeploymentPhaseEvent(
  event: DeploymentPhaseEvent,
): event is DeploymentPhaseEvent & { stepKey: ObservableDeploymentRunStepKey } {
  return event.stepKey !== 'completed' && event.status !== null;
}

function mapStepToPhase(stepKey: ObservableDeploymentRunStepKey): DeploymentPromotionStage {
  switch (stepKey) {
    case 'queued':
      return 'queued';
    case 'preparing_source':
      return 'preparing_source';
    case 'building_image':
      return 'building_image';
    case 'publishing_image':
      return 'publishing_image';
    case 'release':
      return 'releasing';
  }
}
