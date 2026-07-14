import type {
  DeploymentReconcileProjection,
  DeploymentReconcileTarget,
  ResolvedOptionalServiceReadinessConfig,
  WorkerObserveDeploymentReconcileRequest,
  WorkerPrepareDeploymentReconcileRequest,
} from '@compartment/contracts';
import {
  findNextDeploymentReconcilePair,
  persistDeploymentReconcileObservation,
  prepareDeploymentReconcileReference,
} from '../queries/deployment-reconcile.query';
import type { DeploymentReconcilePair, DeploymentReconcileRow } from '../queries/deployment-reconcile.query.types';
import { createId } from '../lib/tokens';
import { readPublicRouteSubdomain } from '../lib/public-route-host';
import { getApiConfig } from '../runtime/runtime-access';
import { synchronizeEdgeAppAccessState } from './app-access-edge.service';
import { buildDeploymentRuntimePlan, type DeploymentRuntimePlan } from './deployment-runtime-plan.service';
import { parseResolvedRelease } from './deployment-release.service';
import { parseResolvedReadiness } from './deployment-readiness.service';
import { parseResolvedRun } from './deployment-run.service';

const defaultContainerPort: number = 3000;
const defaultTerminationGracePeriodSeconds: number = 45;

interface ProjectionRuntime {
  env: Record<string, string>;
  terminationGracePeriodSeconds: number;
}

interface ProjectionBehavior {
  readiness: ResolvedOptionalServiceReadinessConfig;
  releaseCommand: string | null;
  runCommand: string | null;
}

export async function claimDeploymentReconcileTarget(): Promise<DeploymentReconcileTarget | null> {
  const pair: DeploymentReconcilePair | null = await findNextDeploymentReconcilePair();
  if (pair === null) {
    return null;
  }
  return {
    active: pair.active === null ? null : await projectDeployment(pair.active),
    candidate: await projectDeployment(pair.candidate),
    revision: pair.candidate.revision,
    rolloutStartedAt: pair.candidate.transitionedAt.toISOString(),
    state: pair.candidate.state,
  };
}

export async function observeDeploymentReconcile(input: WorkerObserveDeploymentReconcileRequest): Promise<boolean> {
  const applied: boolean = await persistDeploymentReconcileObservation({
    deploymentId: input.deploymentId,
    failureMessage: input.message ?? null,
    observation: input.observation,
    observedAt: new Date(input.observedAt),
    revision: input.revision,
  });
  if (applied && input.observation === 'ready') {
    await synchronizeEdgeAppAccessState();
  }
  return applied;
}

export async function prepareDeploymentReconcile(input: WorkerPrepareDeploymentReconcileRequest): Promise<void> {
  const routeSubdomain: string | null = readPublicRouteSubdomain(input.routeHost, getApiConfig().baseDomain);
  if (routeSubdomain === null) {
    throw new Error(`Expected route host ${input.routeHost} to belong to ${getApiConfig().baseDomain}.`);
  }
  await prepareDeploymentReconcileReference({
    deploymentId: input.deploymentId,
    deploymentName: input.deploymentName,
    id: createId('kref'),
    imageRef: input.imageRef,
    namespace: input.namespace,
    networkPolicyNames: input.networkPolicyNames,
    routeId: createId('rte'),
    routeSubdomain,
    serviceName: input.serviceName,
  });
}

async function projectDeployment(row: DeploymentReconcileRow): Promise<DeploymentReconcileProjection> {
  const plan: DeploymentRuntimePlan = await buildDeploymentRuntimePlan(
    row.environmentId,
    row.organizationId,
    row.serviceId,
    row.environmentName,
    row.projectName,
    row.serviceName,
  );
  const configuredPort: number = readContainerPort(plan.runtimeEnv.PORT);
  return createProjection(row, plan, configuredPort);
}

function createProjection(
  row: DeploymentReconcileRow,
  plan: DeploymentRuntimePlan,
  port: number,
): DeploymentReconcileProjection {
  return {
    containerPort: port,
    deploymentId: row.deploymentId,
    environmentId: row.environmentId,
    environmentName: row.environmentName,
    ...projectionRuntime(plan, port),
    image: requiredImage(row),
    imagePullSecretId: row.projectId,
    namespaceId: row.projectId,
    organizationId: row.organizationId,
    organizationName: row.organizationName,
    projectId: row.projectId,
    projectName: row.projectName,
    ...projectionBehavior(row),
    replicas: 1,
    secretId: row.deploymentId,
    serviceId: row.serviceId,
    serviceName: row.serviceName,
  };
}

function projectionBehavior(row: DeploymentReconcileRow): ProjectionBehavior {
  return {
    readiness: parseResolvedReadiness(row.resolvedReadinessJson),
    releaseCommand: parseResolvedRelease(row.resolvedReleaseJson)?.command ?? null,
    runCommand: parseResolvedRun(row.resolvedRunJson).command ?? null,
  };
}

function projectionRuntime(plan: DeploymentRuntimePlan, port: number): ProjectionRuntime {
  return {
    env: { ...plan.runtimeEnv, PORT: port.toString() },
    terminationGracePeriodSeconds: readTerminationGracePeriod(
      plan.runtimeEnv.COMPARTMENT_TERMINATION_GRACE_PERIOD_SECONDS,
    ),
  };
}

function readTerminationGracePeriod(rawValue: string | undefined): number {
  if (rawValue === undefined) {
    return defaultTerminationGracePeriodSeconds;
  }
  const value: number = Number.parseInt(rawValue, 10);
  if (!Number.isInteger(value) || value < defaultTerminationGracePeriodSeconds) {
    throw new Error('COMPARTMENT_TERMINATION_GRACE_PERIOD_SECONDS must be an integer of at least 45.');
  }
  return value;
}

function requiredImage(row: DeploymentReconcileRow): string {
  if (row.image === null || row.image.length === 0) {
    throw new Error(`Deployment ${row.deploymentId} has no published image.`);
  }
  return row.image;
}

function readContainerPort(rawPort: string | undefined): number {
  const port: number = Number.parseInt(rawPort ?? '', 10);
  return Number.isInteger(port) && port > 0 ? port : defaultContainerPort;
}
