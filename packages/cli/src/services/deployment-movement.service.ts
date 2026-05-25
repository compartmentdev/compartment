import {
  defaultCompartmentEnvironmentName,
  type DeploymentListResponse,
  resolveCompartmentEnvironmentName,
  type DeployResponse,
  type DeploymentStatusResponse,
} from '@compartment/contracts';
import {
  listDeployments,
  promoteDeployment as promoteDeploymentApi,
  rollbackDeployment as rollbackDeploymentApi,
  type CompartmentRequester,
} from '@compartment/sdk';
import { createProjectRequester, waitForDeploymentOperationCompletion } from './deployment-operation-runner.service';
import { resolveProjectTarget } from './project-target.service';
import type { AuthenticatedContext } from './context.types';
import type { ResolvedProjectTarget } from './projects.service.types';
import type {
  DeploymentListCommandInput,
  DeploymentCommandServiceScope,
  PromoteCommandInput,
  ProjectDeploymentListResult,
  RollbackCommandInput,
  RollbackDeploymentRequestOptions,
} from './deployment-movement.types';

export async function promoteProjectDeployment(
  context: AuthenticatedContext,
  input: PromoteCommandInput,
): Promise<DeploymentStatusResponse> {
  const request: CompartmentRequester = createProjectRequester(context);
  reportDeploymentMovementProgress(input, 'Resolving deployment target...');
  const target: ResolvedProjectTarget = await resolveProjectTarget(input.cwd, input.projectName);
  const targetEnvironmentName: string = requirePromoteTargetEnvironmentName(input.targetEnvironmentName);
  const serviceName: string | undefined = readDeploymentMovementServiceName(input.scope);
  reportDeploymentMovementProgress(input, 'Promoting deployment...');
  const response: DeployResponse = await promoteDeploymentApi(request, {
    projectName: target.projectName,
    serviceName,
    sourceEnvironmentName: input.sourceEnvironmentName,
    targetEnvironmentName,
  });

  reportDeploymentMovementProgress(input, 'Waiting for deployment promotion...');
  return await waitForDeploymentOperationCompletion(request, response, serviceName, input.onStatusUpdate);
}

export async function rollbackProjectDeployment(
  context: AuthenticatedContext,
  input: RollbackCommandInput,
): Promise<DeploymentStatusResponse> {
  const request: CompartmentRequester = createProjectRequester(context);
  reportDeploymentMovementProgress(input, 'Resolving deployment target...');
  const target: ResolvedProjectTarget = await resolveProjectTarget(input.cwd, input.projectName);
  const environmentName: string = resolveCompartmentEnvironmentName(input.environmentName);
  const rollbackRequest: RollbackDeploymentRequestOptions = buildRollbackDeploymentRequest(input);
  reportDeploymentMovementProgress(input, 'Rolling back deployment...');
  const response: DeployResponse = await rollbackDeploymentApi(request, {
    environmentName,
    projectName: target.projectName,
    ...rollbackRequest,
  });

  reportDeploymentMovementProgress(input, 'Waiting for deployment rollback...');
  return await waitForDeploymentOperationCompletion(
    request,
    response,
    rollbackRequest.serviceName,
    input.onStatusUpdate,
  );
}

export async function listProjectDeployments(
  context: AuthenticatedContext,
  input: DeploymentListCommandInput,
): Promise<ProjectDeploymentListResult> {
  const request: CompartmentRequester = createProjectRequester(context);
  const target: ResolvedProjectTarget = await resolveProjectTarget(input.cwd, input.projectName);
  const environmentName: string | undefined = input.environmentName;

  const response: DeploymentListResponse = await listDeployments(request, {
    environmentName,
    limit: input.limit,
    projectName: target.projectName,
    serviceName: input.serviceName,
  });

  return {
    environmentName: environmentName ?? defaultCompartmentEnvironmentName,
    response,
  };
}

function requirePromoteTargetEnvironmentName(targetEnvironmentName: string | undefined): string {
  if (targetEnvironmentName !== undefined) {
    return targetEnvironmentName;
  }

  throw new Error('Promote requires --to <name>.');
}

function buildRollbackDeploymentRequest(input: RollbackCommandInput): RollbackDeploymentRequestOptions {
  if (input.target.mode === 'run') {
    return {
      targetDeploymentRunId: input.target.targetDeploymentRunId,
    };
  }

  const serviceName: string | undefined = readDeploymentMovementServiceName(input.target.scope);
  if (input.target.mode === 'deployment') {
    return {
      serviceName,
      targetDeploymentId: input.target.targetDeploymentId,
    };
  }

  return {
    serviceName,
  };
}

function readDeploymentMovementServiceName(scope: DeploymentCommandServiceScope): string | undefined {
  if (scope.kind === 'all') {
    return undefined;
  }

  return scope.serviceName;
}

function reportDeploymentMovementProgress(input: PromoteCommandInput | RollbackCommandInput, message: string): void {
  input.reportProgress?.(message);
}
