import type { DeploymentReconcileProjection, DeploymentReconcileTarget } from '@compartment/contracts';
import {
  kubeNamespaceName,
  type KubeDeploymentManifest,
  type KubeObservation,
  type KubeObservedManifest,
  type KubeRolloutObservation,
  type KubeRuntime,
  readKubeApplicationRunningStartedAt,
  readKubeRolloutObservation,
} from '@compartment/kube-runtime';
import type { DeploymentRolloutStartTracker } from './worker-deployment-rollout-start-tracker.service';

export async function readCandidateRolloutObservation(
  runtime: KubeRuntime,
  observed: KubeObservedManifest | null,
  deployment: KubeDeploymentManifest,
  target: DeploymentReconcileTarget,
  infrastructureTimeoutMs: number,
  rolloutStarts: DeploymentRolloutStartTracker,
): Promise<KubeRolloutObservation | null> {
  if (readRolloutObservation(observed, deployment, target, infrastructureTimeoutMs, null) === null) {
    return null;
  }
  const observedStartedAt: Date | null = await readCandidateApplicationStartedAt(
    runtime,
    deployment,
    target,
    infrastructureTimeoutMs,
  );
  const applicationStartedAt: Date | null = rolloutStarts.retain(
    target.candidate.deploymentId,
    observedStartedAt,
    maximumRolloutDeadlineAt(target, infrastructureTimeoutMs),
  );
  return readRolloutObservation(observed, deployment, target, infrastructureTimeoutMs, applicationStartedAt);
}

export function readRolloutObservation(
  observed: KubeObservedManifest | null,
  deployment: KubeDeploymentManifest,
  target: DeploymentReconcileTarget,
  infrastructureTimeoutMs: number,
  applicationStartedAt: Date | null,
): KubeRolloutObservation | null {
  const deadlineAt: Date = rolloutDeadlineAt(target, infrastructureTimeoutMs, applicationStartedAt);
  return readKubeRolloutObservation(observed, deployment, deadlineAt);
}

async function readCandidateApplicationStartedAt(
  runtime: KubeRuntime,
  deployment: KubeDeploymentManifest,
  target: DeploymentReconcileTarget,
  infrastructureTimeoutMs: number,
): Promise<Date | null> {
  const projection: DeploymentReconcileProjection = target.candidate;
  const controller: AbortController = new AbortController();
  const now: number = Date.now();
  const remainingMs: number = Math.max(0, observationDeadlineAt(target, infrastructureTimeoutMs, now) - now);
  const timer: NodeJS.Timeout = setTimeout(
    (): void => controller.abort(new Error('Kubernetes rollout observation exceeded its infrastructure deadline.')),
    remainingMs,
  );
  let observation: KubeObservation | null = null;
  try {
    observation = await observeCandidateApplication(runtime, deployment, projection, controller);
    return observation === null
      ? null
      : readKubeApplicationRunningStartedAt(observation.cache.values(), projection.deploymentId);
  } finally {
    clearTimeout(timer);
    await observation?.stop();
  }
}

function observationDeadlineAt(
  target: DeploymentReconcileTarget,
  infrastructureTimeoutMs: number,
  now: number,
): number {
  const infrastructureDeadline: number = infrastructureRolloutDeadlineAt(target, infrastructureTimeoutMs).getTime();
  return now < infrastructureDeadline
    ? infrastructureDeadline
    : maximumRolloutDeadlineAt(target, infrastructureTimeoutMs).getTime();
}

async function observeCandidateApplication(
  runtime: KubeRuntime,
  deployment: KubeDeploymentManifest,
  projection: DeploymentReconcileProjection,
  controller: AbortController,
): Promise<KubeObservation | null> {
  try {
    return await runtime.observe(
      {
        labels: candidatePodLabels(deployment),
        namespace: kubeNamespaceName(projection.namespaceId),
        resources: ['pods'],
      },
      controller.signal,
    );
  } catch (error) {
    if (!controller.signal.aborted) {
      throw error;
    }
    return null;
  }
}

function candidatePodLabels(deployment: KubeDeploymentManifest): Readonly<Record<string, string>> {
  const labels: Record<string, string> | undefined = deployment.spec?.template.metadata.labels;
  if (labels === undefined) {
    throw new Error('Applied Kubernetes Deployment is missing candidate Pod labels.');
  }
  return labels;
}

function rolloutDeadlineAt(
  target: DeploymentReconcileTarget,
  infrastructureTimeoutMs: number,
  applicationStartedAt: Date | null,
): Date {
  const infrastructureDeadline: Date = infrastructureRolloutDeadlineAt(target, infrastructureTimeoutMs);
  const readinessTimeoutMs: number | undefined = target.candidate.readiness?.timeoutMs;
  if (
    applicationStartedAt === null ||
    applicationStartedAt.getTime() > infrastructureDeadline.getTime() ||
    readinessTimeoutMs === undefined
  ) {
    return infrastructureDeadline;
  }
  return new Date(
    Math.min(
      maximumRolloutDeadlineAt(target, infrastructureTimeoutMs).getTime(),
      applicationStartedAt.getTime() + readinessTimeoutMs,
    ),
  );
}

export function maximumRolloutDeadlineAt(target: DeploymentReconcileTarget, infrastructureTimeoutMs: number): Date {
  const readinessTimeoutMs: number = target.candidate.readiness?.timeoutMs ?? 0;
  return new Date(infrastructureRolloutDeadlineAt(target, infrastructureTimeoutMs).getTime() + readinessTimeoutMs);
}

export function infrastructureRolloutDeadlineAt(
  target: DeploymentReconcileTarget,
  infrastructureTimeoutMs: number,
): Date {
  return new Date(new Date(target.rolloutStartedAt).getTime() + infrastructureTimeoutMs);
}
