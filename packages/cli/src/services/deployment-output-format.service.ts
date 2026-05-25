import type {
  ResolvedCompartmentServiceRestartConfig,
  ResolvedOptionalServiceReadinessConfig,
} from '@compartment/contracts';

export function formatDeploymentBuildPackageList(packages: readonly string[]): string {
  return packages.length > 0 ? packages.join(', ') : 'n/a';
}

export function formatDeploymentReadiness(readiness: ResolvedOptionalServiceReadinessConfig): string {
  if (readiness === null) {
    return 'none';
  }

  return `${readiness.type} ${readiness.path} ${readiness.timeoutMs.toString()}ms`;
}

export function formatDeploymentRestartPolicy(restart: ResolvedCompartmentServiceRestartConfig): string {
  if (restart.maxRetries === undefined) {
    return restart.policy;
  }

  return `${restart.policy} (${restart.maxRetries.toString()} retries)`;
}
