import type { WorkerArtifactCleanupTarget, WorkerRecoverDeploymentsResponse } from '@compartment/contracts';

export interface OrphanedDeploymentRecoveryOutcome {
  cleanupArtifacts: WorkerArtifactCleanupTarget[];
  error: Error | null;
  recovered: boolean;
}

export interface RecoveredDeploymentResult {
  cleanupArtifacts: WorkerArtifactCleanupTarget[];
  recovered: boolean;
}

export interface RecoveredCompletionResult {
  cleanupArtifacts: WorkerArtifactCleanupTarget[];
  handled: boolean;
}

export interface RecoveryOutcomeSummary {
  cleanupArtifacts: WorkerArtifactCleanupTarget[];
  firstRecoveryError: Error | null;
  recoveredDeploymentCount: number;
}

export function summarizeRecoveryOutcomes(
  recoveryOutcomes: readonly OrphanedDeploymentRecoveryOutcome[],
): RecoveryOutcomeSummary {
  const cleanupArtifacts: WorkerArtifactCleanupTarget[] = [];
  let recoveredDeploymentCount: number = 0;
  let firstRecoveryError: Error | null = null;

  for (const recoveryOutcome of recoveryOutcomes) {
    cleanupArtifacts.push(...recoveryOutcome.cleanupArtifacts);
    recoveredDeploymentCount += recoveryOutcome.recovered ? 1 : 0;
    firstRecoveryError ??= recoveryOutcome.error;
  }

  return {
    cleanupArtifacts,
    firstRecoveryError,
    recoveredDeploymentCount,
  };
}

export function buildRecoveredDeploymentResult(
  recovered: boolean,
  cleanupArtifacts: WorkerArtifactCleanupTarget[] = [],
): RecoveredDeploymentResult {
  return {
    cleanupArtifacts,
    recovered,
  };
}

export function toWorkerRecoverDeploymentsResponse(
  summary: Pick<RecoveryOutcomeSummary, 'cleanupArtifacts' | 'recoveredDeploymentCount'>,
): WorkerRecoverDeploymentsResponse {
  return {
    cleanupArtifacts: summary.cleanupArtifacts,
    recoveredDeploymentCount: summary.recoveredDeploymentCount,
  };
}
