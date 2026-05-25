import {
  buildCompartmentVariableBindingPathname,
  buildCompartmentVariablePathname,
  compartmentVariableGroupCapturePathname,
  compartmentVariableGroupImportPathname,
  compartmentVariableGroupVariablesPathname,
  compartmentVariableGroupsPathname,
  compartmentVariablesPathname,
  type VariableGroupBindingRequest,
  type VariableTargetQuery,
} from '@compartment/contracts';
import { buildListPath } from './list-path.service';

export function buildVariableCollectionPath(query: VariableTargetQuery): string {
  return buildVariableTargetPath(compartmentVariablesPathname, query);
}

export function buildVariableItemPath(keyName: string, query: VariableTargetQuery): string {
  return buildVariableTargetPath(buildCompartmentVariablePathname(keyName), query);
}

export function buildVariableGroupCollectionPath(): string {
  return compartmentVariableGroupsPathname;
}

export function buildVariableGroupCapturePath(): string {
  return compartmentVariableGroupCapturePathname;
}

export function buildVariableGroupImportPath(): string {
  return compartmentVariableGroupImportPathname;
}

export function buildVariableGroupVariableCollectionPath(): string {
  return compartmentVariableGroupVariablesPathname;
}

export function buildVariableBindingItemPath(query: VariableGroupBindingRequest): string {
  return buildVariableTargetPath(buildCompartmentVariableBindingPathname(query.variableGroupName), query);
}

function buildVariableTargetPath(basePath: string, query: VariableTargetQuery): string {
  return buildListPath(basePath, [
    { name: 'projectName', value: query.projectName },
    { name: 'environmentName', value: query.environmentName },
    { name: 'serviceName', value: query.serviceName },
    { name: 'resourceName', value: query.resourceName },
  ]);
}
