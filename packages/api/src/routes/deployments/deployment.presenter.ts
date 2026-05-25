import {
  type DeployResponse,
  type DeploymentInspectRuntimeSummary,
  type DeploymentInspectResponse,
  type DeploymentInspectTarget,
  type DeploymentSummary,
  type RuntimeActiveDeployment,
} from '@compartment/contracts';
import type {
  DeployResponseInput,
  DeploymentInspectTargetInput,
  DeploymentSummaryInput,
} from '../../services/presenter.types';
import type { DeploymentInspectLookupResult } from '../../services/deployments.service.types';
import { parseResolvedBuild } from '../../services/deployment-build.service';
import { parseResolvedReadiness } from '../../services/deployment-readiness.service';
import { readNullableDeploymentUpstreamHost } from '../../services/deployment-upstream.service';
import { parseResolvedRun } from '../../services/deployment-run.service';
import { toNullableIsoString } from '../presenters/date.presenter';
import { buildEnvironmentSummary } from '../presenters/environment-summary.presenter';
import { buildOperationSummary } from '../presenters/operation.presenter';
import { buildProjectSummary } from '../presenters/project-summary.presenter';
import { buildResourceSummary } from '../presenters/resource-summary.presenter';
import { parseSerializedCompartmentRoutes } from '../../services/compartment-routes.service';
import { buildDeploymentBaseSummary, readVisibleDeploymentRouteHost } from './deployment-summary.presenter';

export function buildDeployResponse(input: DeployResponseInput): DeployResponse {
  const deployments: DeploymentSummary[] = input.deployments.map(buildDeploymentSummary);
  const firstDeployment: DeploymentSummaryInput = input.deployments[0]!;

  return {
    deploymentRunId: firstDeployment.deployment.deploymentRunId,
    deployments,
    environment: buildEnvironmentSummary(firstDeployment.environment),
    project: buildProjectSummary(firstDeployment.project),
    resources: input.resources.map(buildResourceSummary),
  };
}

export function buildDeploymentInspectResponseForRole(
  result: DeploymentInspectLookupResult,
  sensitiveTopologyVisible: boolean,
): DeploymentInspectResponse {
  return {
    activeDeployments: result.activeDeployments.map(
      (deployment: DeploymentInspectTargetInput): DeploymentInspectTarget =>
        buildDeploymentInspectTarget(deployment, sensitiveTopologyVisible),
    ),
    deployments: result.deployments.map(
      (deployment: DeploymentInspectTargetInput): DeploymentInspectTarget =>
        buildDeploymentInspectTarget(deployment, sensitiveTopologyVisible),
    ),
    environment: buildEnvironmentSummary(result.environment),
    project: buildProjectSummary(result.project),
    sensitiveTopologyVisible,
  };
}

function buildDeploymentInspectTarget(
  parts: DeploymentInspectTargetInput,
  sensitiveTopologyVisible: boolean,
): DeploymentInspectTarget {
  return {
    ...buildDeploymentSummary(parts),
    containerId: sensitiveTopologyVisible ? parts.deployment.containerId : null,
    drain:
      sensitiveTopologyVisible && parts.deployment.drainingContainerId !== null
        ? {
            containerId: parts.deployment.drainingContainerId,
            deadlineAt: toNullableIsoString(parts.deployment.drainDeadlineAt),
          }
        : null,
    routes: parseSerializedCompartmentRoutes(parts.deployment.resolvedRoutesJson),
    routeHost: readVisibleDeploymentRouteHost(parts),
    upstreamHost: buildDeploymentInspectUpstreamHost(parts, sensitiveTopologyVisible),
    upstreamPort: sensitiveTopologyVisible ? parts.deployment.upstreamPort : null,
    runtime: buildDeploymentInspectRuntime(parts.runtime, sensitiveTopologyVisible),
  };
}

function buildDeploymentInspectRuntime(
  runtime: RuntimeActiveDeployment | null,
  sensitiveTopologyVisible: boolean,
): DeploymentInspectRuntimeSummary | null {
  if (runtime === null || !sensitiveTopologyVisible) {
    return null;
  }

  return {
    containerId: runtime.containerId,
    imageRef: runtime.imageRef,
    routeHost: runtime.routeHost,
    upstreamHost: runtime.upstreamHost,
    upstreamPort: runtime.upstreamPort,
  };
}

function buildDeploymentInspectUpstreamHost(
  parts: DeploymentInspectTargetInput,
  sensitiveTopologyVisible: boolean,
): string | null {
  if (!sensitiveTopologyVisible) {
    return null;
  }

  return readNullableDeploymentUpstreamHost(parts.deployment.upstreamHost, parts.deployment.upstreamPort);
}

export function buildDeploymentSummary(parts: DeploymentSummaryInput): DeploymentSummary {
  return {
    ...buildDeploymentBaseSummary(parts),
    build: parseResolvedBuild(parts.artifact.resolvedBuildJson),
    containerId: parts.deployment.containerId,
    operation: buildOperationSummary(parts.operation),
    readiness: parseResolvedReadiness(parts.deployment.resolvedReadinessJson),
    run: parseResolvedRun(parts.deployment.resolvedRunJson),
  };
}
