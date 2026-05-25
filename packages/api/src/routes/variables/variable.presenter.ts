import type {
  ImportVariablesResponse,
  RemoveVariableResponse,
  VariableDetail,
  VariableListItem,
  VariableListResponse,
  VariableLocalRunItem,
  VariableLocalRunResponse,
  VariableResponse,
} from '@compartment/contracts';
import type { ListedVariable } from '../../services/effective-variables.service.types';
import type {
  ImportVariablesResult,
  VariableDetailResult,
  VariableListResult,
  VariableLocalRunResult,
  VariableLocalRunValue,
  VariableResult,
} from '../../services/variables.service.types';
import { buildEnvironmentSummary } from '../presenters/environment-summary.presenter';
import { buildProjectSummary } from '../presenters/project-summary.presenter';

export function buildVariableListResponse(result: VariableListResult): VariableListResponse {
  return {
    environment: buildEnvironmentSummary(result.environment),
    project: buildProjectSummary(result.project),
    resourceName: result.resourceName,
    serviceName: result.serviceName,
    variables: result.variables.map((variable: ListedVariable): VariableListItem => buildVariableListItem(variable)),
  };
}

export function buildVariableResponse(result: VariableResult): VariableResponse {
  return {
    environment: buildEnvironmentSummary(result.environment),
    project: buildProjectSummary(result.project),
    resourceName: result.resourceName,
    serviceName: result.serviceName,
    variable: buildVariableDetail(result.variable),
  };
}

export function buildVariableLocalRunResponse(result: VariableLocalRunResult): VariableLocalRunResponse {
  return {
    accessEventId: result.accessEventId,
    environment: buildEnvironmentSummary(result.environment),
    project: buildProjectSummary(result.project),
    resourceName: result.resourceName,
    serviceName: result.serviceName,
    variables: result.variables.map(
      (variable: VariableLocalRunValue): VariableLocalRunItem => buildVariableLocalRunItem(variable),
    ),
  };
}

export function buildRemoveVariableResponse(): RemoveVariableResponse {
  return {
    success: true,
  };
}

export function buildImportVariablesResponse(result: ImportVariablesResult): ImportVariablesResponse {
  return {
    environment: buildEnvironmentSummary(result.environment),
    importedKeyNames: result.importedKeyNames,
    project: buildProjectSummary(result.project),
    resourceName: result.resourceName,
    serviceName: result.serviceName,
  };
}

function buildVariableDetail(variable: VariableDetailResult): VariableDetail {
  return {
    ...buildVariableListItem(variable),
    value: variable.value,
    valueHidden: variable.valueHidden,
  };
}

function buildVariableLocalRunItem(variable: VariableLocalRunValue): VariableLocalRunItem {
  return {
    ...buildVariableListItem(variable),
    value: variable.value,
    valueFingerprint: variable.valueFingerprint,
  };
}

function buildVariableListItem(variable: ListedVariable): VariableListItem {
  return {
    keyName: variable.keyName,
    scopeResourceName: variable.scopeResourceName,
    scopeServiceName: variable.scopeServiceName,
    scopeType: variable.scopeType,
    sensitivity: variable.sensitivity,
    sourceResourceOutput: variable.sourceResourceOutput,
    sourceType: variable.sourceType,
    sourceVariableSetName: variable.sourceVariableSetName,
  };
}
