import {
  readCompartmentDescriptorCompatibilityWarnings,
  type CompartmentAuthoredDescriptor,
  type CompartmentRoutesFile,
} from '@compartment/contracts';
import { findJoinedDeploymentById } from '../queries/deployment-joined.query';
import type { DeploymentJoinedRow, DeploymentRow } from '../queries/deployments.query.types';
import type { SourceUploadRow } from '../queries/source-uploads.query.types';
import { getApiConfig } from '../runtime/runtime-access';
import {
  requireJoinedDeployment,
  resolveDescriptorServices,
  resolveEnvironmentName,
  resolveProjectContext,
} from './deployment-context.service';
import type {
  DeployInputContext,
  DeploymentSourceProvenance,
  ResolvedDescriptorService,
  ResolvedProjectContext,
} from './deployments.service.types';
import {
  buildPreparedQueuedDeploymentState,
  resolveDescriptorServiceBuild,
} from './deployment-creation.service.helpers';
import { resolveSourceUploadDeploymentRunTriggerType } from './deployment-creation.service.access';
import type { PreparedQueuedDeploymentState } from './deployment-creation.service.types';
import { buildDeploymentBuildEnvSnapshot } from './deployment-build-plan.service';
import { validateDescriptorBuildEnv } from './deployment-build-env-validation.service';
import type { BuildEnvSnapshot } from './deployment-build.types';
import type { DescriptorServiceConnectionBindingPlan } from './deployment-service-connections.service.types';
import {
  prepareDeployDescriptorServiceConnectionBindingPlan,
  reconcileDeclaredResourcesAndDescriptorServiceConnections,
  validateDeployDescriptorServiceConnectionPreflight,
} from './deployment-service-connections.reconcile';
import { validateDescriptorRoutes } from './compartment-routes.service';
import {
  appendDescriptorCompatibilityWarningEvents,
  appendQueuedDeploymentRunEvents,
  createDeploymentRunId,
  withDeploymentRunCleanupOnError,
} from './deployment-run-creation.service';
import type { DeployResponseInput } from './presenter.types';
import { readValidatedFirstDeployOnboardingSessionId } from './onboarding-first-deploy-correlation.service';
import type { ResourceListResult } from './resources.service.types';
import {
  buildSourceUploadConsumptionScope,
  queuePreparedDeployments,
  requireAuthorizedSubmitSourceUpload,
} from './deployment-source-upload-queue.service';

export async function createDeploymentsFromSourceUpload(input: DeployInputContext): Promise<DeployResponseInput> {
  validateDescriptorRoutes(input.descriptor, input.routes);
  const descriptorServices: ResolvedDescriptorService[] = resolveDescriptorServices(
    input.descriptor,
    input.serviceName,
  );
  const environmentName: string = resolveEnvironmentName(input.environmentName);
  const sourceUpload: SourceUploadRow = await requireAuthorizedSubmitSourceUpload(input, environmentName);
  // Keep validation before service/resource sync; it ignores stale descriptor-owned bindings no longer declared.
  await validateDescriptorBuildEnv(input, descriptorServices, environmentName);
  await validateDeployDescriptorServiceConnectionPreflight(input, descriptorServices, environmentName);
  const contexts: ResolvedProjectContext[] = await resolveDeployContexts(input, descriptorServices, environmentName);
  const connectionBindingPlan: DescriptorServiceConnectionBindingPlan =
    await prepareDeployDescriptorServiceConnectionBindingPlan(input.actorPrincipalId, contexts);
  const onboardingSessionId: string | null = await readDeployOnboardingSessionId(input);
  const resources: ResourceListResult = await reconcileDeclaredResourcesAndDescriptorServiceConnections(
    input,
    connectionBindingPlan,
  );

  return {
    deployments: await queueDeploymentsFromValidatedSourceUpload(input, contexts, sourceUpload, onboardingSessionId),
    resources: resources.resources,
  };
}

async function readDeployOnboardingSessionId(input: DeployInputContext): Promise<string | null> {
  return await readValidatedFirstDeployOnboardingSessionId({
    actorPrincipalId: input.actorPrincipalId,
    onboardingSessionId: input.onboardingSessionId,
    organizationId: input.organizationId,
  });
}

async function resolveDeployContexts(
  input: DeployInputContext,
  descriptorServices: readonly ResolvedDescriptorService[],
  environmentName: string,
): Promise<ResolvedProjectContext[]> {
  const contexts: ResolvedProjectContext[] = [];

  for (const descriptorService of descriptorServices) {
    contexts.push(
      await resolveProjectContext(
        input.actorPrincipalId,
        input.organizationSlug,
        input.descriptor.name,
        descriptorService,
        environmentName,
      ),
    );
  }

  return contexts;
}

async function queueDeploymentsFromValidatedSourceUpload(
  input: DeployInputContext,
  contexts: readonly ResolvedProjectContext[],
  sourceUpload: SourceUploadRow,
  onboardingSessionId: string | null,
): Promise<DeploymentJoinedRow[]> {
  const deploymentRunId: string = await createDeploymentRunId({
    environmentId: contexts[0]!.environment.id,
    label: input.label,
    onboardingSessionId,
    sourceProvenance: input.sourceProvenance,
    triggerType: resolveSourceUploadDeploymentRunTriggerType(input.sourceProvenance),
    updatedAt: new Date(),
  });
  return await withDeploymentRunCleanupOnError(
    deploymentRunId,
    async (): Promise<DeploymentJoinedRow[]> =>
      await queueValidatedDeploymentRun(deploymentRunId, input, contexts, sourceUpload),
  );
}

async function queueValidatedDeploymentRun(
  deploymentRunId: string,
  input: DeployInputContext,
  contexts: readonly ResolvedProjectContext[],
  sourceUpload: SourceUploadRow,
): Promise<DeploymentJoinedRow[]> {
  await appendDeployCompatibilityWarnings(deploymentRunId, input.descriptor);
  const queuedDeployments: DeploymentRow[] = await createQueuedDeploymentsForSourceUploadRun(
    deploymentRunId,
    input,
    contexts,
    sourceUpload,
  );

  await appendQueuedDeploymentRunEvents(queuedDeployments);
  return await findQueuedJoinedDeployments(queuedDeployments);
}

async function appendDeployCompatibilityWarnings(
  deploymentRunId: string,
  descriptor: CompartmentAuthoredDescriptor,
): Promise<void> {
  await appendDescriptorCompatibilityWarningEvents(
    deploymentRunId,
    readCompartmentDescriptorCompatibilityWarnings(descriptor),
  );
}

async function createQueuedDeploymentsForSourceUploadRun(
  deploymentRunId: string,
  input: DeployInputContext,
  contexts: readonly ResolvedProjectContext[],
  sourceUpload: SourceUploadRow,
): Promise<DeploymentRow[]> {
  const preparedStates: PreparedQueuedDeploymentState[] = await prepareQueuedDeploymentStates(
    deploymentRunId,
    input.sourceProvenance,
    contexts,
    input.routes,
    sourceUpload,
  );

  return await queuePreparedDeployments(
    preparedStates,
    buildSourceUploadConsumptionScope(input, contexts, sourceUpload),
    input.label,
  );
}

async function prepareQueuedDeploymentStates(
  deploymentRunId: string,
  sourceProvenance: DeploymentSourceProvenance | undefined,
  contexts: readonly ResolvedProjectContext[],
  routes: CompartmentRoutesFile | undefined,
  sourceUpload: SourceUploadRow,
): Promise<PreparedQueuedDeploymentState[]> {
  const preparedStates: PreparedQueuedDeploymentState[] = [];

  for (const context of contexts) {
    preparedStates.push(
      await prepareQueuedDeploymentState(deploymentRunId, sourceProvenance, context, routes, sourceUpload),
    );
  }

  return preparedStates;
}

async function prepareQueuedDeploymentState(
  deploymentRunId: string,
  sourceProvenance: DeploymentSourceProvenance | undefined,
  context: ResolvedProjectContext,
  routes: CompartmentRoutesFile | undefined,
  sourceUpload: SourceUploadRow,
): Promise<PreparedQueuedDeploymentState> {
  const buildEnvSnapshot: BuildEnvSnapshot = await buildDeploymentBuildEnvSnapshot(
    resolveDescriptorServiceBuild(context.descriptorService),
    context.environment.id,
    context.organization.id,
    context.service.id,
    context.service.name,
  );

  return buildPreparedQueuedDeploymentState(
    deploymentRunId,
    sourceProvenance,
    context,
    routes,
    sourceUpload,
    buildEnvSnapshot,
  );
}

async function findQueuedJoinedDeployments(queuedDeployments: DeploymentRow[]): Promise<DeploymentJoinedRow[]> {
  const joinedDeployments: DeploymentJoinedRow[] = [];

  for (const queuedDeployment of queuedDeployments) {
    joinedDeployments.push(
      requireJoinedDeployment(await findJoinedDeploymentById(queuedDeployment.id, getApiConfig().baseDomain)),
    );
  }

  return joinedDeployments;
}
