import {
  type ResourceDeleteResponse,
  type ResourceBackupCreateResponse,
  type ResourceBackupListResponse,
  type ResourceBackupShowResponse,
  type ResourceListResponse,
  type ResourceLogsResponse,
  type ResourceOutputListResponse,
  type ResourceOutputResponse,
  type ResourceResponse,
  type ResourceRestoreResponse,
  type ResourceRestoreAsResponse,
  type ResourceTargetQuery,
  resourceRestoreConfirmation,
} from '@compartment/contracts';
import {
  deleteResource as deleteResourceApi,
  createResourceBackup as createResourceBackupApi,
  getResource as getResourceApi,
  getResourceOutput as getResourceOutputApi,
  getResourceLogs as getResourceLogsApi,
  listResourceBackups as listResourceBackupsApi,
  listResourceOutputs as listResourceOutputsApi,
  listResources as listResourcesApi,
  restoreResourceBackup as restoreResourceBackupApi,
  restoreResourceBackupAs as restoreResourceBackupAsApi,
  showResourceBackup as showResourceBackupApi,
  startResource as startResourceApi,
  stopResource as stopResourceApi,
  type CompartmentRequester,
} from '@compartment/sdk';
import { createAuthenticatedRequester, requireOrganizationContext } from './context.service';
import type { AuthenticatedContext } from './context.types';
import { resolveProjectTarget } from './project-target.service';
import type { ResolvedProjectTarget } from './projects.service.types';
import type {
  ResourceDeleteInput,
  ResourceBackupShowInput,
  ResourceLogsInput,
  ResourceOutputInput,
  ResourceRestoreAsInput,
  ResourceRestoreExistingInput,
  ResourceRestoreInput,
  ResourceScopeInput,
  ResourceTargetInput,
} from './resources.service.types';

const resourceOperationRequestTimeoutMs: number = 15 * 60 * 1000;

export async function listResources(
  context: AuthenticatedContext,
  input: ResourceScopeInput,
): Promise<ResourceListResponse> {
  const request: CompartmentRequester = createResourceRequester(context);
  const target: ResolvedProjectTarget = await resolveProjectTarget(input.cwd, input.projectName);

  return await listResourcesApi(request, {
    environmentName: input.environmentName,
    projectName: target.projectName,
  });
}

export async function inspectResource(
  context: AuthenticatedContext,
  input: ResourceTargetInput,
): Promise<ResourceResponse> {
  return await getResourceApi(createResourceRequester(context), await resolveResourceTarget(input));
}

export async function readResourceLogs(
  context: AuthenticatedContext,
  input: ResourceLogsInput,
): Promise<ResourceLogsResponse> {
  const target: ResourceTargetQuery = await resolveResourceTarget(input);

  return await getResourceLogsApi(createResourceRequester(context), {
    ...target,
    ...(input.since !== undefined ? { since: input.since } : {}),
    ...(input.tailLines !== undefined ? { tailLines: input.tailLines } : {}),
  });
}

export async function listResourceOutputs(
  context: AuthenticatedContext,
  input: ResourceTargetInput,
): Promise<ResourceOutputListResponse> {
  return await listResourceOutputsApi(createResourceRequester(context), await resolveResourceTarget(input));
}

export async function showResourceOutput(
  context: AuthenticatedContext,
  input: ResourceOutputInput,
): Promise<ResourceOutputResponse> {
  const target: ResourceTargetQuery = await resolveResourceTarget(input);

  return await getResourceOutputApi(createResourceRequester(context), {
    ...target,
    outputName: input.outputName,
    ...(input.reveal === true ? { reveal: true } : {}),
  });
}

export async function startResource(
  context: AuthenticatedContext,
  input: ResourceTargetInput,
): Promise<ResourceResponse> {
  return await startResourceApi(createResourceRequester(context), await resolveResourceTarget(input));
}

export async function stopResource(
  context: AuthenticatedContext,
  input: ResourceTargetInput,
): Promise<ResourceResponse> {
  return await stopResourceApi(createResourceRequester(context), await resolveResourceTarget(input));
}

export async function deleteResource(
  context: AuthenticatedContext,
  input: ResourceDeleteInput,
): Promise<ResourceDeleteResponse> {
  return await deleteResourceApi(createResourceRequester(context), await resolveResourceTarget(input), {
    ...(input.deleteData === true ? { confirmation: 'delete-resource-data', deleteData: true } : {}),
  });
}

export async function createResourceBackup(
  context: AuthenticatedContext,
  input: ResourceTargetInput,
): Promise<ResourceBackupCreateResponse> {
  return await createResourceBackupApi(createResourceOperationRequester(context), await resolveResourceTarget(input));
}

export async function listResourceBackups(
  context: AuthenticatedContext,
  input: ResourceTargetInput,
): Promise<ResourceBackupListResponse> {
  return await listResourceBackupsApi(createResourceRequester(context), await resolveResourceTarget(input));
}

export async function showResourceBackup(
  context: AuthenticatedContext,
  input: ResourceBackupShowInput,
): Promise<ResourceBackupShowResponse> {
  const target: ResolvedProjectTarget = await resolveProjectTarget(input.cwd, input.projectName);

  return await showResourceBackupApi(createResourceRequester(context), {
    backupId: input.backupId,
    environmentName: input.environmentName,
    projectName: target.projectName,
  });
}

export async function restoreResourceBackup(
  context: AuthenticatedContext,
  input: ResourceRestoreInput,
): Promise<ResourceRestoreResponse | ResourceRestoreAsResponse> {
  const request: CompartmentRequester = createResourceOperationRequester(context);

  if (input.targetResourceName !== undefined) {
    return await restoreResourceBackupAsInput(request, input);
  }

  return await restoreExistingResourceBackup(request, input);
}

async function restoreResourceBackupAsInput(
  request: CompartmentRequester,
  input: ResourceRestoreAsInput,
): Promise<ResourceRestoreAsResponse> {
  const target: ResolvedProjectTarget = await resolveProjectTarget(input.cwd, input.projectName);

  return await restoreResourceBackupAsApi(
    request,
    {
      backupId: input.backupId,
      environmentName: input.environmentName,
      projectName: target.projectName,
    },
    { targetResourceName: input.targetResourceName },
  );
}

async function restoreExistingResourceBackup(
  request: CompartmentRequester,
  input: ResourceRestoreExistingInput,
): Promise<ResourceRestoreResponse> {
  if (input.confirmed !== true) {
    throw new Error('Resource restore requires --yes.');
  }

  return await restoreResourceBackupApi(request, await resolveResourceTarget(input), {
    backupId: input.backupId,
    confirmation: resourceRestoreConfirmation,
  });
}

function createResourceRequester(context: AuthenticatedContext): CompartmentRequester {
  return createAuthenticatedRequester(requireOrganizationContext(context), {
    includeCurrentOrganization: true,
  });
}

function createResourceOperationRequester(context: AuthenticatedContext): CompartmentRequester {
  return createAuthenticatedRequester(requireOrganizationContext(context), {
    includeCurrentOrganization: true,
    requestTimeoutMs: resourceOperationRequestTimeoutMs,
  });
}

async function resolveResourceTarget(input: ResourceTargetInput): Promise<ResourceTargetQuery> {
  const target: ResolvedProjectTarget = await resolveProjectTarget(input.cwd, input.projectName);

  return {
    environmentName: input.environmentName,
    projectName: target.projectName,
    resourceName: input.resourceName,
  };
}
