import {
  buildCompartmentArtifactImageRepository,
  defaultAppRouteAccessMode,
  resolveCompartmentServiceBuildConfig,
  resolveCompartmentServiceReleaseConfig,
  resolveCompartmentServiceRunConfig,
  resolveServiceReadinessConfig,
  type AppRouteAccessMode,
  type CompartmentRoutesFile,
  type ResolvedCompartmentServiceBuildConfig,
  type ResolvedCompartmentServiceRunConfig,
  type ResolvedOptionalCompartmentServiceReleaseConfig,
  type ResolvedOptionalServiceReadinessConfig,
} from '@compartment/contracts';
import { createId } from '../lib/tokens';
import type {
  CreateBuildArtifactInput,
  CreateQueuedDeploymentBatchDeploymentInput,
  CreateQueuedDeploymentBatchItem,
} from '../queries/deployments.query.types';
import type { InsertOperationInput } from '../queries/operations.query.types';
import type { SourceUploadRow } from '../queries/source-uploads.query.types';
import { filterSourceCompartmentRoutes, serializeCompartmentRoutes } from './compartment-routes.service';
import type { BuildEnvSnapshot } from './deployment-build.types';
import { serializeResolvedBuild, serializeResolvedBuildEnv } from './deployment-build.service';
import { serializeResolvedReadiness } from './deployment-readiness.service';
import { serializeResolvedRelease } from './deployment-release.service';
import { serializeResolvedRun } from './deployment-run.service';
import type { PreparedQueuedDeploymentState } from './deployment-creation.service.types';
import { buildDeploymentTargetLabel } from './deployment-target-label.service';
import type {
  DeploymentSourceProvenance,
  ResolvedDescriptorService,
  ResolvedProjectContext,
} from './deployments.service.types';
import { buildQueuedDeploymentBaseInput } from './queued-deployment-input.service';

export function buildQueuedDeploymentBatchItem(
  preparedState: PreparedQueuedDeploymentState,
  actorPrincipalId: string,
  label: string | undefined,
): CreateQueuedDeploymentBatchItem {
  return {
    deployment: buildQueuedDeploymentInput(preparedState, label),
    operation: buildQueuedOperationInput(preparedState.context, actorPrincipalId),
    artifact: buildQueuedArtifactInput(preparedState, actorPrincipalId),
  };
}

function buildQueuedArtifactInput(
  preparedState: PreparedQueuedDeploymentState,
  actorPrincipalId: string,
): CreateBuildArtifactInput {
  return {
    createdByPrincipalId: actorPrincipalId,
    id: preparedState.artifactId,
    imageRepository: buildCompartmentArtifactImageRepository(
      preparedState.context.project.id,
      preparedState.context.service.id,
    ),
    projectId: preparedState.context.project.id,
    projectServiceId: preparedState.context.service.id,
    resolvedBuildJson: serializeResolvedBuild(resolveDescriptorServiceBuild(preparedState.context.descriptorService)),
    resolvedBuildEnvJson: serializeResolvedBuildEnv(preparedState.buildEnvSnapshot),
    sourceDigest: preparedState.sourceDigest,
    sourceUploadId: preparedState.sourceUploadId,
    updatedAt: new Date(),
  };
}

export function resolveDescriptorServiceBuild(
  descriptorService: ResolvedDescriptorService | undefined,
): ResolvedCompartmentServiceBuildConfig {
  return descriptorService?.build ?? resolveCompartmentServiceBuildConfig(undefined);
}

export function buildPreparedQueuedDeploymentState(
  deploymentRunId: string,
  sourceProvenance: DeploymentSourceProvenance | undefined,
  context: ResolvedProjectContext,
  routes: CompartmentRoutesFile | undefined,
  sourceUpload: SourceUploadRow,
  buildEnvSnapshot: BuildEnvSnapshot,
): PreparedQueuedDeploymentState {
  return {
    accessMode: resolveDescriptorServiceAccessMode(context.descriptorService),
    artifactId: createId('art'),
    buildEnvSnapshot,
    context,
    deploymentRunId,
    routes: filterSourceCompartmentRoutes(routes, context.service.name),
    sourceDigest: sourceUpload.sourceDigest,
    ...(sourceProvenance !== undefined ? { sourceProvenance } : {}),
    sourceUploadId: sourceUpload.id,
  };
}

function resolveDescriptorServiceAccessMode(
  descriptorService: ResolvedDescriptorService | undefined,
): AppRouteAccessMode {
  return descriptorService?.accessMode ?? defaultAppRouteAccessMode;
}

function buildQueuedDeploymentInput(
  preparedState: PreparedQueuedDeploymentState,
  label: string | undefined,
): CreateQueuedDeploymentBatchDeploymentInput {
  return buildQueuedDeploymentBaseInput({
    accessMode: preparedState.accessMode,
    deploymentRunId: preparedState.deploymentRunId,
    environmentId: preparedState.context.environment.id,
    label,
    projectServiceId: preparedState.context.service.id,
    resolvedReadinessJson: serializeResolvedReadiness(
      resolveDescriptorServiceReadiness(preparedState.context.descriptorService),
    ),
    resolvedReleaseJson: serializeResolvedRelease(
      resolveDescriptorServiceRelease(preparedState.context.descriptorService),
    ),
    resolvedRunJson: serializeResolvedRun(resolveDescriptorServiceRun(preparedState.context.descriptorService)),
    resolvedRoutesJson: serializeCompartmentRoutes(preparedState.routes),
    ...(preparedState.sourceProvenance ?? {}),
  });
}

function resolveDescriptorServiceReadiness(
  descriptorService: ResolvedDescriptorService | undefined,
): ResolvedOptionalServiceReadinessConfig {
  return descriptorService?.readiness ?? resolveServiceReadinessConfig(undefined);
}

function resolveDescriptorServiceRun(
  descriptorService: ResolvedDescriptorService | undefined,
): ResolvedCompartmentServiceRunConfig {
  return descriptorService?.run ?? resolveCompartmentServiceRunConfig(undefined);
}

function resolveDescriptorServiceRelease(
  descriptorService: ResolvedDescriptorService | undefined,
): ResolvedOptionalCompartmentServiceReleaseConfig {
  return descriptorService?.release ?? resolveCompartmentServiceReleaseConfig(undefined);
}

function buildQueuedOperationInput(context: ResolvedProjectContext, actorPrincipalId: string): InsertOperationInput {
  return {
    actorPrincipalId,
    status: 'queued',
    summary: `Queued deployment for ${buildDeploymentTargetLabel(
      context.project.name,
      context.environment.name,
      context.service.name,
    )}`,
    targetId: context.environment.id,
    targetType: 'environment',
    type: 'deployment.run',
  };
}
