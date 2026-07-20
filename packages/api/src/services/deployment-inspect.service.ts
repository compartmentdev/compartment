import { findDeploymentKubeReference } from '../queries/deployment-kube-inspect.query';
import type { DeploymentKubeInspectReference } from '../queries/deployment-kube-inspect.query.types';
import type {
  DeploymentInspectLookupResult,
  DeploymentInspectTargetResult,
  DeploymentStatusLookupResult,
  StatusLookupInput,
} from './deployments.service.types';
import { getDeploymentStatusSummary } from './deployment-status.service';
import type { DeploymentInspectRuntimeInput, DeploymentSummaryInput } from './presenter.types';

export async function getDeploymentInspectSummary(input: StatusLookupInput): Promise<DeploymentInspectLookupResult> {
  const status: DeploymentStatusLookupResult = await getDeploymentStatusSummary(input, 'deployment.inspect');
  return {
    activeDeployments: await enrichInspectTargets(status.activeDeployments),
    deployments: await enrichInspectTargets(status.deployments),
    environment: status.environment,
    project: status.project,
  };
}

async function enrichInspectTargets(deployments: DeploymentSummaryInput[]): Promise<DeploymentInspectTargetResult[]> {
  return await Promise.all(deployments.map(enrichInspectTarget));
}

async function enrichInspectTarget(deployment: DeploymentSummaryInput): Promise<DeploymentInspectTargetResult> {
  const reference: DeploymentKubeInspectReference | undefined = await findDeploymentKubeReference(
    deployment.deployment.id,
  );
  return {
    ...deployment,
    runtime: reference === undefined ? null : buildKubernetesRuntimeDeployment(deployment, reference),
  };
}

function buildKubernetesRuntimeDeployment(
  deployment: DeploymentSummaryInput,
  reference: DeploymentKubeInspectReference,
): DeploymentInspectRuntimeInput {
  return {
    imageRef: requireRuntimeValue(deployment.artifact.imageRef, 'image ref'),
    routeHost: deployment.deployment.routeHost,
    serviceHost: `${reference.serviceName}.${reference.namespace}.svc`,
    servicePort: 80,
  };
}

function requireRuntimeValue(value: string | null, name: string): string {
  if (value === null) {
    throw new Error(`Active Kubernetes deployment is missing its ${name}.`);
  }
  return value;
}
