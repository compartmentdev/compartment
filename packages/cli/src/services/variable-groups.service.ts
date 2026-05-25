import type {
  CaptureVariableGroupResponse,
  ImportVariableGroupResponse,
  VariableGroupBindingRequest,
  VariableGroupBindingResponse,
  VariableGroupListResponse,
  VariableGroupResponse,
  VariableGroupUsagesResponse,
} from '@compartment/contracts';
import {
  bindVariableGroup as bindVariableGroupApi,
  captureVariableGroup as captureVariableGroupApi,
  createVariableGroup as createVariableGroupApi,
  getVariableGroup as getVariableGroupApi,
  importVariableGroup as importVariableGroupApi,
  listVariableGroupUsages as listVariableGroupUsagesApi,
  listVariableGroups as listVariableGroupsApi,
  putVariableGroupVariable as putVariableGroupVariableApi,
  unbindVariableGroup as unbindVariableGroupApi,
  type CompartmentRequester,
} from '@compartment/sdk';
import { createAuthenticatedRequester, requireOrganizationContext } from './context.service';
import type { AuthenticatedContext } from './context.types';
import { resolveProjectTarget } from './project-target.service';
import type { ResolvedProjectTarget } from './projects.service.types';
import type {
  ImportVariableGroupInput,
  PutVariableGroupVariableInput,
  VariableGroupBindingInput,
  VariableGroupCaptureInput,
  VariableGroupReadInput,
} from './variable-groups.service.types';

export async function createVariableGroup(
  context: AuthenticatedContext,
  input: VariableGroupReadInput,
): Promise<VariableGroupResponse> {
  return await createVariableGroupApi(createVariableRequester(context), {
    variableGroupName: input.variableGroupName,
  });
}

export async function listVariableGroups(context: AuthenticatedContext): Promise<VariableGroupListResponse> {
  return await listVariableGroupsApi(createVariableRequester(context));
}

export async function showVariableGroup(
  context: AuthenticatedContext,
  input: VariableGroupReadInput,
): Promise<VariableGroupResponse> {
  return await getVariableGroupApi(createVariableRequester(context), input.variableGroupName);
}

export async function listVariableGroupUsages(
  context: AuthenticatedContext,
  input: VariableGroupReadInput,
): Promise<VariableGroupUsagesResponse> {
  return await listVariableGroupUsagesApi(createVariableRequester(context), input.variableGroupName);
}

export async function putVariableGroupVariable(
  context: AuthenticatedContext,
  input: PutVariableGroupVariableInput,
): Promise<VariableGroupResponse> {
  return await putVariableGroupVariableApi(createVariableRequester(context), {
    keyName: input.keyName,
    ...(input.sensitivity !== undefined ? { sensitivity: input.sensitivity } : {}),
    value: input.value,
    variableGroupName: input.variableGroupName,
  });
}

export async function importVariableGroup(
  context: AuthenticatedContext,
  input: ImportVariableGroupInput,
): Promise<ImportVariableGroupResponse> {
  return await importVariableGroupApi(createVariableRequester(context), {
    entries: input.entries,
    ...(input.replace !== undefined ? { replace: input.replace } : {}),
    ...(input.sensitivity !== undefined ? { sensitivity: input.sensitivity } : {}),
    variableGroupName: input.variableGroupName,
  });
}

export async function captureVariableGroup(
  context: AuthenticatedContext,
  input: VariableGroupCaptureInput,
): Promise<CaptureVariableGroupResponse> {
  const target: ResolvedProjectTarget = await resolveProjectTarget(input.cwd, input.projectName);

  return await captureVariableGroupApi(createVariableRequester(context), {
    ...(input.effective !== undefined ? { effective: input.effective } : {}),
    ...(input.environmentName !== undefined ? { environmentName: input.environmentName } : {}),
    projectName: target.projectName,
    ...(input.resourceName !== undefined ? { resourceName: input.resourceName } : {}),
    ...(input.serviceName !== undefined ? { serviceName: input.serviceName } : {}),
    variableGroupName: input.variableGroupName,
  });
}

export async function bindVariableGroup(
  context: AuthenticatedContext,
  input: VariableGroupBindingInput,
): Promise<VariableGroupBindingResponse> {
  return await bindVariableGroupApi(createVariableRequester(context), await buildVariableGroupBindingRequest(input));
}

export async function unbindVariableGroup(
  context: AuthenticatedContext,
  input: VariableGroupBindingInput,
): Promise<VariableGroupBindingResponse> {
  return await unbindVariableGroupApi(createVariableRequester(context), await buildVariableGroupBindingRequest(input));
}

function createVariableRequester(context: AuthenticatedContext): CompartmentRequester {
  return createAuthenticatedRequester(requireOrganizationContext(context), {
    includeCurrentOrganization: true,
  });
}

async function buildVariableGroupBindingRequest(
  input: VariableGroupBindingInput,
): Promise<VariableGroupBindingRequest> {
  const target: ResolvedProjectTarget = await resolveProjectTarget(input.cwd, input.projectName);

  return {
    ...(input.environmentName !== undefined ? { environmentName: input.environmentName } : {}),
    projectName: target.projectName,
    ...(input.resourceName !== undefined ? { resourceName: input.resourceName } : {}),
    ...(input.serviceName !== undefined ? { serviceName: input.serviceName } : {}),
    variableGroupName: input.variableGroupName,
  };
}
