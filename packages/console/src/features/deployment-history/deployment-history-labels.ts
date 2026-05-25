import type {
  DeploymentPromotionStage,
  DeploymentRunStepKey,
  DeploymentRunStepStatus,
  DeploymentRunTriggerType,
  DeploymentRuntimeStatus,
} from '@compartment/contracts/browser';
import type { StatusTagIconName, StatusTagVariant } from '../../components/ui/status-tag';

export const deploymentStatusLabels: Record<DeploymentRuntimeStatus, string> = {
  failed: 'Failed',
  queued: 'Queued',
  running: 'Running',
  stopped: 'Stopped',
  succeeded: 'Succeeded',
};

export const deploymentStageLabels: Record<DeploymentPromotionStage, string> = {
  active: 'Active',
  building: 'Building',
  checking_readiness: 'Checking readiness',
  draining_previous: 'Draining previous',
  release: 'Release',
  rolled_back: 'Rolled back',
  starting_candidate: 'Starting candidate',
  stopped: 'Stopped',
  switching_route: 'Switching route',
};

export const deploymentRunStepLabels: Record<DeploymentRunStepKey, string> = {
  queued: 'Queued',
  preparing_source: 'Preparing source',
  building_image: 'Building image',
  publishing_image: 'Publishing image',
  release: 'Release',
  starting_candidate: 'Starting candidate',
  checking_readiness: 'Checking readiness',
  switching_route: 'Switching route',
  draining_previous: 'Draining previous',
  completed: 'Completed',
};

export const deploymentRunStepStatusLabels: Record<DeploymentRunStepStatus, string> = {
  failed: 'Failed',
  running: 'Running',
  skipped: 'Skipped',
  succeeded: 'Succeeded',
};

export const deploymentTriggerLabels: Record<DeploymentRunTriggerType, string> = {
  autosync: 'Autosync',
  manual: 'Manual',
  promote: 'Promote',
  rollback: 'Rollback',
  start: 'Start',
};

export function readDeploymentStatusTagVariant(status: DeploymentRuntimeStatus): StatusTagVariant {
  switch (status) {
    case 'failed':
      return 'error';
    case 'succeeded':
      return 'success';
    case 'running':
    case 'queued':
    case 'stopped':
      return 'secondary';
  }
}

export function readDeploymentStatusTagIcon(status: DeploymentRuntimeStatus): StatusTagIconName {
  switch (status) {
    case 'failed':
      return 'failed';
    case 'queued':
      return 'archived-queued';
    case 'running':
      return 'updating';
    case 'stopped':
      return 'stopped';
    case 'succeeded':
      return 'succeeded';
  }
}

export function readDeploymentStageTagVariant(stage: DeploymentPromotionStage): StatusTagVariant {
  switch (stage) {
    case 'active':
      return 'success';
    case 'rolled_back':
      return 'error';
    case 'building':
    case 'checking_readiness':
    case 'draining_previous':
    case 'release':
    case 'starting_candidate':
    case 'switching_route':
    case 'stopped':
      return 'secondary';
  }
}

export function readDeploymentStageTagIcon(stage: DeploymentPromotionStage): StatusTagIconName {
  switch (stage) {
    case 'active':
      return 'active';
    case 'building':
      return 'updating';
    case 'checking_readiness':
      return 'checking-readiness';
    case 'draining_previous':
      return 'draining-previous';
    case 'release':
      return 'release';
    case 'rolled_back':
      return 'rolled-back';
    case 'starting_candidate':
      return 'starting-candidate';
    case 'stopped':
      return 'stopped';
    case 'switching_route':
      return 'switching';
  }
}

export function readDeploymentRunStepTagVariant(status: DeploymentRunStepStatus): StatusTagVariant {
  switch (status) {
    case 'failed':
      return 'error';
    case 'succeeded':
      return 'success';
    case 'running':
    case 'skipped':
      return 'secondary';
  }
}

export function readDeploymentRunStepTagIcon(status: DeploymentRunStepStatus): StatusTagIconName {
  switch (status) {
    case 'failed':
      return 'failed';
    case 'running':
      return 'updating';
    case 'skipped':
      return 'not-deployed';
    case 'succeeded':
      return 'succeeded';
  }
}
