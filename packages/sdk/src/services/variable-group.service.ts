import {
  buildCompartmentVariableGroupPathname,
  buildCompartmentVariableGroupUsagesPathname,
  captureVariableGroupRequestSchema,
  captureVariableGroupResponseSchema,
  createVariableGroupRequestSchema,
  importVariableGroupRequestSchema,
  importVariableGroupResponseSchema,
  putVariableGroupVariableRequestSchema,
  variableGroupListResponseSchema,
  variableGroupResponseSchema,
  variableGroupUsagesResponseSchema,
  type CaptureVariableGroupRequest,
  type CaptureVariableGroupResponse,
  type CreateVariableGroupRequest,
  type ImportVariableGroupRequest,
  type ImportVariableGroupResponse,
  type PutVariableGroupVariableRequest,
  type VariableGroupListResponse,
  type VariableGroupResponse,
  type VariableGroupUsagesResponse,
} from '@compartment/contracts';
import type { CompartmentRequester } from '../http/request.types';
import {
  buildVariableGroupCapturePath,
  buildVariableGroupCollectionPath,
  buildVariableGroupImportPath,
  buildVariableGroupVariableCollectionPath,
} from './variable-path.service';

export async function createVariableGroup(
  request: CompartmentRequester,
  body: CreateVariableGroupRequest,
): Promise<VariableGroupResponse> {
  return await request<VariableGroupResponse, CreateVariableGroupRequest>({
    body: createVariableGroupRequestSchema.parse(body),
    method: 'POST',
    path: buildVariableGroupCollectionPath(),
    schema: variableGroupResponseSchema,
  });
}

export async function listVariableGroups(request: CompartmentRequester): Promise<VariableGroupListResponse> {
  return await request<VariableGroupListResponse, undefined>({
    method: 'GET',
    path: buildVariableGroupCollectionPath(),
    schema: variableGroupListResponseSchema,
  });
}

export async function getVariableGroup(
  request: CompartmentRequester,
  variableGroupName: string,
): Promise<VariableGroupResponse> {
  return await request<VariableGroupResponse, undefined>({
    method: 'GET',
    path: buildCompartmentVariableGroupPathname(variableGroupName),
    schema: variableGroupResponseSchema,
  });
}

export async function putVariableGroupVariable(
  request: CompartmentRequester,
  body: PutVariableGroupVariableRequest,
): Promise<VariableGroupResponse> {
  return await request<VariableGroupResponse, PutVariableGroupVariableRequest>({
    body: putVariableGroupVariableRequestSchema.parse(body),
    method: 'POST',
    path: buildVariableGroupVariableCollectionPath(),
    schema: variableGroupResponseSchema,
  });
}

export async function importVariableGroup(
  request: CompartmentRequester,
  body: ImportVariableGroupRequest,
): Promise<ImportVariableGroupResponse> {
  return await request<ImportVariableGroupResponse, ImportVariableGroupRequest>({
    body: importVariableGroupRequestSchema.parse(body),
    method: 'POST',
    path: buildVariableGroupImportPath(),
    schema: importVariableGroupResponseSchema,
  });
}

export async function captureVariableGroup(
  request: CompartmentRequester,
  body: CaptureVariableGroupRequest,
): Promise<CaptureVariableGroupResponse> {
  return await request<CaptureVariableGroupResponse, CaptureVariableGroupRequest>({
    body: captureVariableGroupRequestSchema.parse(body),
    method: 'POST',
    path: buildVariableGroupCapturePath(),
    schema: captureVariableGroupResponseSchema,
  });
}

export async function listVariableGroupUsages(
  request: CompartmentRequester,
  variableGroupName: string,
): Promise<VariableGroupUsagesResponse> {
  return await request<VariableGroupUsagesResponse, undefined>({
    method: 'GET',
    path: buildCompartmentVariableGroupUsagesPathname(variableGroupName),
    schema: variableGroupUsagesResponseSchema,
  });
}
