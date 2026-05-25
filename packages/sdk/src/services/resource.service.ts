import {
  buildCompartmentResourceBackupCollectionPathname,
  buildCompartmentResourceBackupRestorePathname,
  buildCompartmentResourceBackupShowPathname,
  buildCompartmentResourceLogsPathname,
  buildCompartmentResourceOutputPathname,
  buildCompartmentResourceOutputsPathname,
  buildCompartmentResourcePathname,
  buildCompartmentResourceRestorePathname,
  buildCompartmentResourceStartPathname,
  buildCompartmentResourceStopPathname,
  compartmentResourcesPathname,
  resourceDeleteResponseSchema,
  resourceBackupCreateResponseSchema,
  resourceBackupListResponseSchema,
  resourceBackupShowResponseSchema,
  resourceListResponseSchema,
  resourceLogsResponseSchema,
  resourceOutputListResponseSchema,
  resourceOutputResponseSchema,
  resourceRestoreResponseSchema,
  resourceRestoreAsResponseSchema,
  resourceResponseSchema,
  type ResourceDeleteRequest,
  type ResourceDeleteResponse,
  type ResourceBackupCreateResponse,
  type ResourceBackupListResponse,
  type ResourceBackupShowQuery,
  type ResourceBackupShowResponse,
  type ResourceListQuery,
  type ResourceListResponse,
  type ResourceLogsQuery,
  type ResourceLogsResponse,
  type ResourceOutputListResponse,
  type ResourceOutputQuery,
  type ResourceOutputResponse,
  type ResourceResponse,
  type ResourceRestoreRequest,
  type ResourceRestoreResponse,
  type ResourceRestoreAsRequest,
  type ResourceRestoreAsResponse,
  type ResourceTargetQuery,
} from '@compartment/contracts';
import type { CompartmentRequester } from '../http/request.types';
import { buildListPath, type ListPathParam } from './list-path.service';

export async function listResources(
  request: CompartmentRequester,
  query: ResourceListQuery,
): Promise<ResourceListResponse> {
  return await request<ResourceListResponse, undefined>({
    method: 'GET',
    path: buildResourceRequestPath(compartmentResourcesPathname, query),
    schema: resourceListResponseSchema,
  });
}

export async function getResource(
  request: CompartmentRequester,
  query: ResourceTargetQuery,
): Promise<ResourceResponse> {
  return await request<ResourceResponse, undefined>({
    method: 'GET',
    path: buildResourceRequestPath(buildCompartmentResourcePathname(query.resourceName), query),
    schema: resourceResponseSchema,
  });
}

export async function getResourceLogs(
  request: CompartmentRequester,
  query: ResourceLogsQuery,
): Promise<ResourceLogsResponse> {
  return await request<ResourceLogsResponse, undefined>({
    method: 'GET',
    path: buildResourceRequestPath(buildCompartmentResourceLogsPathname(query.resourceName), query, [
      { name: 'since', value: query.since },
      { name: 'tailLines', value: query.tailLines },
    ]),
    schema: resourceLogsResponseSchema,
  });
}

export async function listResourceOutputs(
  request: CompartmentRequester,
  query: ResourceTargetQuery,
): Promise<ResourceOutputListResponse> {
  return await request<ResourceOutputListResponse, undefined>({
    method: 'GET',
    path: buildResourceRequestPath(buildCompartmentResourceOutputsPathname(query.resourceName), query),
    schema: resourceOutputListResponseSchema,
  });
}

export async function getResourceOutput(
  request: CompartmentRequester,
  query: ResourceOutputQuery,
): Promise<ResourceOutputResponse> {
  return await request<ResourceOutputResponse, undefined>({
    method: 'GET',
    path: buildResourceRequestPath(
      buildCompartmentResourceOutputPathname(query.resourceName, query.outputName),
      query,
      [{ name: 'reveal', value: query.reveal === true ? 'true' : undefined }],
    ),
    schema: resourceOutputResponseSchema,
  });
}

export async function startResource(
  request: CompartmentRequester,
  query: ResourceTargetQuery,
): Promise<ResourceResponse> {
  return await request<ResourceResponse, undefined>({
    method: 'POST',
    path: buildResourceRequestPath(buildCompartmentResourceStartPathname(query.resourceName), query),
    schema: resourceResponseSchema,
  });
}

export async function stopResource(
  request: CompartmentRequester,
  query: ResourceTargetQuery,
): Promise<ResourceResponse> {
  return await request<ResourceResponse, undefined>({
    method: 'POST',
    path: buildResourceRequestPath(buildCompartmentResourceStopPathname(query.resourceName), query),
    schema: resourceResponseSchema,
  });
}

export async function deleteResource(
  request: CompartmentRequester,
  query: ResourceTargetQuery,
  body: ResourceDeleteRequest,
): Promise<ResourceDeleteResponse> {
  return await request<ResourceDeleteResponse, ResourceDeleteRequest>({
    body,
    method: 'DELETE',
    path: buildResourceRequestPath(buildCompartmentResourcePathname(query.resourceName), query),
    schema: resourceDeleteResponseSchema,
  });
}

export async function createResourceBackup(
  request: CompartmentRequester,
  query: ResourceTargetQuery,
): Promise<ResourceBackupCreateResponse> {
  return await request<ResourceBackupCreateResponse, undefined>({
    method: 'POST',
    path: buildResourceRequestPath(buildCompartmentResourceBackupCollectionPathname(query.resourceName), query),
    schema: resourceBackupCreateResponseSchema,
  });
}

export async function listResourceBackups(
  request: CompartmentRequester,
  query: ResourceTargetQuery,
): Promise<ResourceBackupListResponse> {
  return await request<ResourceBackupListResponse, undefined>({
    method: 'GET',
    path: buildResourceRequestPath(buildCompartmentResourceBackupCollectionPathname(query.resourceName), query),
    schema: resourceBackupListResponseSchema,
  });
}

export async function showResourceBackup(
  request: CompartmentRequester,
  query: ResourceBackupShowQuery,
): Promise<ResourceBackupShowResponse> {
  return await request<ResourceBackupShowResponse, undefined>({
    method: 'GET',
    path: buildResourceRequestPath(buildCompartmentResourceBackupShowPathname(query.backupId), query),
    schema: resourceBackupShowResponseSchema,
  });
}

export async function restoreResourceBackup(
  request: CompartmentRequester,
  query: ResourceTargetQuery,
  body: ResourceRestoreRequest,
): Promise<ResourceRestoreResponse> {
  return await request<ResourceRestoreResponse, ResourceRestoreRequest>({
    body,
    method: 'POST',
    path: buildResourceRequestPath(buildCompartmentResourceRestorePathname(query.resourceName), query),
    schema: resourceRestoreResponseSchema,
  });
}

export async function restoreResourceBackupAs(
  request: CompartmentRequester,
  query: ResourceBackupShowQuery,
  body: ResourceRestoreAsRequest,
): Promise<ResourceRestoreAsResponse> {
  return await request<ResourceRestoreAsResponse, ResourceRestoreAsRequest>({
    body,
    method: 'POST',
    path: buildResourceRequestPath(buildCompartmentResourceBackupRestorePathname(query.backupId), query),
    schema: resourceRestoreAsResponseSchema,
  });
}

function buildResourceRequestPath(
  pathname: string,
  query: ResourceListQuery,
  extraParams: readonly ListPathParam[] = [],
): string {
  return buildListPath(pathname, [...buildResourceListPathParams(query), ...extraParams]);
}

function buildResourceListPathParams(query: ResourceListQuery): readonly ListPathParam[] {
  return [
    { name: 'projectName', value: query.projectName },
    { name: 'environmentName', value: query.environmentName },
  ];
}
