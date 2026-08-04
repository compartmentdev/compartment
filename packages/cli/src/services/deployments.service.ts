import {
  type CompartmentAuthoredDescriptor,
  type DeployResponse,
  type DeploymentInspectResponse,
  type DeploymentLogsResponse,
  type DeploymentMetricsSnapshot,
  type DeploymentStatusQuery,
  type DeploymentStatusResponse,
} from '@compartment/contracts';
import {
  deployProject as deployProjectApi,
  getDeploymentInspect,
  getDeploymentMetrics,
  getDeploymentLogs,
  getDeploymentStatus,
  type CompartmentRequester,
} from '@compartment/sdk';
import { createSourceArchive, type CreatedSourceArchive } from '@compartment/source-archive';
import { createProjectRequester, waitForDeploymentOperationCompletion } from './deployment-operation-runner.service';
import { createAuthenticatedRequester, requireOrganizationContext } from './context.service';
import type { AuthenticatedContext } from './context.types';
import { resolveProjectTarget } from './project-target.service';
import type {
  DeployCommandInput,
  DeployCommandResult,
  InspectCommandInput,
  LogsCommandInput,
  DeploymentStatusView,
  StatusCommandInput,
} from './deployments.types';
import type { StoredProjectDescriptor } from './project-descriptor.types';
import type { ResolvedProjectTarget } from './projects.service.types';

const deploySubmitRequestTimeoutMs: number = 15 * 60 * 1000;

export async function deployProject(
  context: AuthenticatedContext,
  input: DeployCommandInput,
): Promise<DeployResponse | DeployCommandResult> {
  reportDeployProgress(input, 'Resolving deployment target...');
  const target: ResolvedProjectTarget = await resolveProjectTarget(input.cwd, input.projectName);
  const descriptor: StoredProjectDescriptor = requireDeploymentDescriptor(target);
  const deployResponse: DeployResponse = await submitProjectDeployment(context, descriptor, target.projectName, input);

  if (input.detach === true) {
    return deployResponse;
  }

  reportDeployProgress(input, 'Waiting for deployment to finish...');
  const request: CompartmentRequester = createProjectRequester(context);
  return createDeployCommandResult(
    deployResponse,
    await waitForDeploymentOperationCompletion(request, deployResponse, input.serviceName, input.onStatusUpdate),
  );
}

function createDeployCommandResult(
  deployResponse: DeployResponse,
  status: DeploymentStatusResponse,
): DeployCommandResult {
  return {
    ...status,
    resources: deployResponse.resources,
  };
}

async function submitProjectDeployment(
  context: AuthenticatedContext,
  descriptor: StoredProjectDescriptor,
  projectName: string,
  input: DeployCommandInput,
): Promise<DeployResponse> {
  const deployRequest: CompartmentRequester = createDeploySubmitRequester(context);

  return await startProjectDeployment(deployRequest, context, descriptor, projectName, input);
}

export async function getProjectDeploymentStatus(
  context: AuthenticatedContext,
  input: StatusCommandInput,
): Promise<DeploymentStatusView> {
  const request: CompartmentRequester = createProjectRequester(context);
  const target: ResolvedProjectTarget = await resolveProjectTarget(input.cwd, input.projectName);
  const environmentName: string | undefined = input.environmentName;

  const query: DeploymentStatusQuery = {
    environmentName,
    projectName: target.projectName,
    serviceName: input.serviceName,
  };
  const [status, metrics]: [DeploymentStatusResponse, DeploymentMetricsSnapshot] = await Promise.all([
    getDeploymentStatus(request, query),
    readDeploymentMetrics(request, query),
  ]);
  return { ...status, metrics };
}

async function readDeploymentMetrics(
  request: CompartmentRequester,
  query: DeploymentStatusQuery,
): Promise<DeploymentMetricsSnapshot> {
  try {
    return await getDeploymentMetrics(request, query);
  } catch {
    return { observedAt: null, pods: [], state: 'unavailable' };
  }
}

export async function getProjectDeploymentInspect(
  context: AuthenticatedContext,
  input: InspectCommandInput,
): Promise<DeploymentInspectResponse> {
  const request: CompartmentRequester = createProjectRequester(context);
  const target: ResolvedProjectTarget = await resolveProjectTarget(input.cwd, input.projectName);
  const environmentName: string | undefined = input.environmentName;

  return await getDeploymentInspect(request, {
    environmentName,
    projectName: target.projectName,
    serviceName: input.serviceName,
  });
}

export async function getProjectDeploymentLogs(
  context: AuthenticatedContext,
  input: LogsCommandInput,
): Promise<DeploymentLogsResponse> {
  const request: CompartmentRequester = createProjectRequester(context);
  const target: ResolvedProjectTarget = await resolveProjectTarget(input.cwd, input.projectName);
  const environmentName: string | undefined = input.environmentName;

  return await getDeploymentLogs(request, {
    environmentName,
    projectName: target.projectName,
    serviceName: input.serviceName,
    since: input.since,
  });
}

async function startProjectDeployment(
  deployRequest: CompartmentRequester,
  context: AuthenticatedContext,
  descriptor: StoredProjectDescriptor,
  projectName: string,
  input: DeployCommandInput,
): Promise<DeployResponse> {
  reportDeployProgress(input, 'Preparing source archive...');
  const sourceArchive: CreatedSourceArchive = await readProjectSourceArchive(descriptor, input.serviceName);

  reportDeployProgress(input, 'Submitting deployment...');
  return await deployProjectApi(
    deployRequest,
    {
      descriptor: createDeployDescriptor(descriptor, projectName),
      environmentName: input.environmentName,
      label: input.label,
      onboardingSessionId: context.firstDeployOnboardingSessionId,
      projectName,
      ...(descriptor.routes !== undefined ? { routes: descriptor.routes } : {}),
      serviceName: input.serviceName,
    },
    sourceArchive.sourceArchive,
    sourceArchive.sourceDigest,
  );
}

async function readProjectSourceArchive(
  descriptor: StoredProjectDescriptor,
  serviceName: string | undefined,
): Promise<CreatedSourceArchive> {
  return await createSourceArchive({
    descriptor: descriptor.descriptor,
    descriptorFilePath: descriptor.filePath,
    ...(descriptor.routes !== undefined ? { routes: descriptor.routes } : {}),
    ...(serviceName !== undefined ? { serviceName } : {}),
  });
}

function requireDeploymentDescriptor(target: ResolvedProjectTarget): StoredProjectDescriptor {
  if (target.descriptor === undefined) {
    throw createMissingDeployDescriptorError();
  }

  return target.descriptor;
}

function createDeployDescriptor(
  descriptor: StoredProjectDescriptor,
  projectName: string,
): CompartmentAuthoredDescriptor {
  return {
    ...descriptor.descriptor,
    name: projectName,
  };
}

function createDeploySubmitRequester(context: AuthenticatedContext): CompartmentRequester {
  return createTimedProjectRequester(context, deploySubmitRequestTimeoutMs);
}

function createTimedProjectRequester(context: AuthenticatedContext, requestTimeoutMs: number): CompartmentRequester {
  return createAuthenticatedRequester(requireOrganizationContext(context), {
    includeCurrentOrganization: true,
    requestTimeoutMs,
  });
}

function createMissingDeployDescriptorError(): Error {
  return new Error(
    'compartment.yml was not found in the current directory. compartment deploy requires a local compartment repo.',
  );
}

function reportDeployProgress(input: DeployCommandInput, message: string): void {
  input.reportProgress?.(message);
}
