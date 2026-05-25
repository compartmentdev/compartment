import type { DeploymentReadSummary } from '@compartment/contracts';

export function readDeploymentDurationLabel(deployment: DeploymentReadSummary, now: number): string | null {
  const startedAtMs: number = Date.parse(deployment.operation.createdAt);
  const completedAtMs: number =
    deployment.operation.completedAt !== null ? Date.parse(deployment.operation.completedAt) : now;
  if (Number.isNaN(startedAtMs) || Number.isNaN(completedAtMs) || completedAtMs < startedAtMs) {
    return null;
  }

  return formatDuration(completedAtMs - startedAtMs);
}

function formatDuration(durationMs: number): string {
  if (durationMs < 1000) {
    return `${durationMs}ms`;
  }
  if (durationMs < 60_000) {
    return `${(durationMs / 1000).toFixed(1)}s`;
  }

  const minutes: number = Math.floor(durationMs / 60_000);
  const seconds: number = Math.round((durationMs % 60_000) / 1000);
  if (seconds === 0) {
    return `${minutes}m`;
  }

  return `${minutes}m ${seconds}s`;
}
