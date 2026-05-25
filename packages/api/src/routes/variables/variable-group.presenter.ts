import type {
  CaptureVariableGroupResponse,
  ImportVariableGroupResponse,
  VariableGroupBindingResponse,
  VariableGroupDetail,
  VariableGroupListResponse,
  VariableGroupResponse,
  VariableGroupSummary,
  VariableGroupUsage,
  VariableGroupUsagesResponse,
  VariableGroupVariable,
} from '@compartment/contracts';
import type {
  CaptureVariableGroupResult,
  ImportVariableGroupResult,
  VariableGroupBindingResult,
  VariableGroupDetailResult,
  VariableGroupListResult,
  VariableGroupResponseResult,
  VariableGroupSummaryResult,
  VariableGroupUsageResult,
  VariableGroupUsagesResult,
  VariableGroupVariableResult,
} from '../../services/variable-groups.service.types';
import { buildEnvironmentSummary } from '../presenters/environment-summary.presenter';
import { buildProjectSummary } from '../presenters/project-summary.presenter';

export function buildVariableGroupListResponse(result: VariableGroupListResult): VariableGroupListResponse {
  return {
    variableGroups: result.variableGroups.map(buildVariableGroupSummary),
  };
}

export function buildVariableGroupResponse(result: VariableGroupResponseResult): VariableGroupResponse {
  return {
    variableGroup: buildVariableGroupDetail(result.variableGroup),
  };
}

export function buildImportVariableGroupResponse(result: ImportVariableGroupResult): ImportVariableGroupResponse {
  return {
    importedKeyNames: result.importedKeyNames,
    variableGroup: buildVariableGroupDetail(result.variableGroup),
  };
}

export function buildCaptureVariableGroupResponse(result: CaptureVariableGroupResult): CaptureVariableGroupResponse {
  return {
    capturedKeyNames: result.capturedKeyNames,
    environment: buildEnvironmentSummary(result.environment),
    project: buildProjectSummary(result.project),
    resourceName: result.resourceName,
    serviceName: result.serviceName,
    variableGroup: buildVariableGroupDetail(result.variableGroup),
  };
}

export function buildVariableGroupUsagesResponse(result: VariableGroupUsagesResult): VariableGroupUsagesResponse {
  return {
    usages: result.usages.map(buildVariableGroupUsage),
    variableGroup: buildVariableGroupSummary(result.variableGroup),
  };
}

export function buildVariableGroupBindingResponse(result: VariableGroupBindingResult): VariableGroupBindingResponse {
  return {
    environment: buildEnvironmentSummary(result.environment),
    project: buildProjectSummary(result.project),
    resourceName: result.resourceName,
    serviceName: result.serviceName,
    variableGroupName: result.variableGroupName,
  };
}

function buildVariableGroupDetail(result: VariableGroupDetailResult): VariableGroupDetail {
  return {
    ...buildVariableGroupSummary(result),
    variables: result.variables.map(buildVariableGroupVariable),
  };
}

function buildVariableGroupSummary(result: VariableGroupSummaryResult): VariableGroupSummary {
  return {
    createdAt: result.createdAt.toISOString(),
    description: result.description,
    name: result.name,
    updatedAt: result.updatedAt.toISOString(),
    variableCount: result.variableCount,
  };
}

function buildVariableGroupVariable(result: VariableGroupVariableResult): VariableGroupVariable {
  return {
    keyName: result.keyName,
    sensitivity: result.sensitivity,
  };
}

function buildVariableGroupUsage(result: VariableGroupUsageResult): VariableGroupUsage {
  return {
    environmentName: result.environmentName,
    projectName: result.projectName,
    resourceName: result.resourceName,
    serviceName: result.serviceName,
  };
}
