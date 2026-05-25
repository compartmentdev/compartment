import type { DeploymentRunTriggerType } from '@compartment/contracts';
import type { deploymentRuns } from '../db/schema';
import type { CreateDeploymentSourceProvenanceInput } from './deployments.query.types';

export type PersistedDeploymentRunRow = typeof deploymentRuns.$inferSelect;

export interface DeploymentRunRow {
  createdAt: Date;
  environmentId: string;
  id: string;
  label: string | null;
  onboardingSessionId: string | null;
  sourceAutomationPrincipalId: string | null;
  sourceBindingId: string | null;
  sourceBindingSnapshotJson: string | null;
  sourceCommitSha: string | null;
  sourceEventId: string | null;
  sourceId: string | null;
  sourceKind: string | null;
  sourceRepositorySnapshotJson: string | null;
  sourceResolutionTaskId: string | null;
  triggerType: DeploymentRunTriggerType;
  updatedAt: Date;
}

export interface CreateDeploymentRunInput extends CreateDeploymentSourceProvenanceInput {
  createdAt?: Date | undefined;
  environmentId: string;
  id: string;
  label?: string | null | undefined;
  onboardingSessionId?: string | null | undefined;
  triggerType: DeploymentRunTriggerType;
  updatedAt: Date;
}

export interface FindDeploymentRunByProjectInput {
  deploymentRunId: string;
  environmentName?: string | undefined;
  projectId: string;
}
