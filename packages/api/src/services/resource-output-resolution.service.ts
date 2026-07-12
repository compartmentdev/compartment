import type { CompartmentResourceOutputConfig } from '@compartment/contracts';
import { kubeResourceServiceDns } from '@compartment/utils';
import { createInvalidDeployConfigError } from '../errors/api-business-error';
import { createVariableValueFingerprint } from '../lib/variables-crypto';
import type { ProjectResourceRow } from '../queries/resources.query.types';
import { getApiConfig } from '../runtime/runtime-access';
import type { EffectiveVariable } from './effective-variables.service.types';
import { parseStoredResourceOutputs, resolveStoredResourceRuntimeEnv } from './resources.service.storage';
import type { ResourceOutputSummaryInput } from './resources.service.types';

interface ResourceOutputResolutionContext {
  environmentName: string;
  namespaceId: string;
  projectName: string;
  resource: ProjectResourceRow;
}

export interface ResolvedResourceOutputPlaintext {
  sensitivity: 'plain' | 'sensitive';
  value: string;
  valueFingerprint: string;
}

const resourceOutputTemplatePattern: RegExp = /\$\{([^}]+)\}/gu;

export function listResolvedResourceOutputSummaries(
  context: ResourceOutputResolutionContext,
  effectiveVariables: EffectiveVariable[],
  reveal: boolean,
): ResourceOutputSummaryInput[] {
  return Object.entries(parseStoredResourceOutputs(context.resource))
    .map(
      ([name, output]: [string, CompartmentResourceOutputConfig]): ResourceOutputSummaryInput =>
        buildResourceOutputSummary(name, output, context, effectiveVariables, reveal),
    )
    .sort((left: ResourceOutputSummaryInput, right: ResourceOutputSummaryInput): number =>
      left.name.localeCompare(right.name),
    );
}

export function resolveResourceOutputPlaintext(
  resource: ProjectResourceRow,
  outputName: string,
  projectName: string,
  environmentName: string,
  namespaceId: string,
  effectiveVariables: EffectiveVariable[],
): ResolvedResourceOutputPlaintext {
  const output: ResourceOutputSummaryInput = resolveResourceOutputSummary(
    outputName,
    { environmentName, namespaceId, projectName, resource },
    effectiveVariables,
    true,
  );
  if (output.value === null || output.valueFingerprint === null) {
    throw createInvalidDeployConfigError(`Resource output "${resource.name}.${outputName}" could not be resolved.`);
  }

  return {
    sensitivity: output.sensitivity,
    value: output.value,
    valueFingerprint: output.valueFingerprint,
  };
}

export function resolveResourceOutputSummary(
  outputName: string,
  context: ResourceOutputResolutionContext,
  effectiveVariables: EffectiveVariable[],
  reveal: boolean,
): ResourceOutputSummaryInput {
  const output: CompartmentResourceOutputConfig | undefined = parseStoredResourceOutputs(context.resource)[outputName];
  if (output === undefined) {
    throw createInvalidDeployConfigError(
      `Resource output "${outputName}" is not declared on resource "${context.resource.name}".`,
    );
  }

  return buildResourceOutputSummary(outputName, output, context, effectiveVariables, reveal);
}

function buildResourceOutputSummary(
  name: string,
  output: CompartmentResourceOutputConfig,
  context: ResourceOutputResolutionContext,
  effectiveVariables: EffectiveVariable[],
  reveal: boolean,
): ResourceOutputSummaryInput {
  const sensitivity: 'plain' | 'sensitive' = output.sensitive ? 'sensitive' : 'plain';
  if (sensitivity === 'sensitive' && !reveal) {
    return buildHiddenResourceOutputSummary(name, sensitivity);
  }

  const value: string = renderResourceOutputTemplate(output.value, context, effectiveVariables);
  return buildVisibleResourceOutputSummary(name, sensitivity, value);
}

function buildHiddenResourceOutputSummary(name: string, sensitivity: 'sensitive'): ResourceOutputSummaryInput {
  return {
    name,
    sensitivity,
    value: null,
    valueFingerprint: null,
    valueHidden: true,
  };
}

function buildVisibleResourceOutputSummary(
  name: string,
  sensitivity: 'plain' | 'sensitive',
  value: string,
): ResourceOutputSummaryInput {
  return {
    name,
    sensitivity,
    value,
    valueFingerprint: createOutputFingerprint(value),
    valueHidden: false,
  };
}

function renderResourceOutputTemplate(
  template: string,
  context: ResourceOutputResolutionContext,
  effectiveVariables: EffectiveVariable[],
): string {
  const env: Map<string, string> = new Map<string, string>(
    resolveStoredResourceRuntimeEnv(context.resource, effectiveVariables).map(
      ({ keyName, value }: { keyName: string; value: string }): [string, string] => [keyName, value],
    ),
  );

  return template.replace(resourceOutputTemplatePattern, (_match: string, key: string): string =>
    resolveResourceOutputPlaceholder(key, context, env),
  );
}

function resolveResourceOutputPlaceholder(
  key: string,
  context: ResourceOutputResolutionContext,
  env: ReadonlyMap<string, string>,
): string {
  if (key.startsWith('env.')) {
    return resolveResourceOutputEnvPlaceholder(key.slice('env.'.length), env);
  }

  return resolveKnownResourceOutputPlaceholder(key, context);
}

function resolveKnownResourceOutputPlaceholder(key: string, context: ResourceOutputResolutionContext): string {
  if (key === 'environment.name') {
    return context.environmentName;
  }
  if (key === 'project.name') {
    return context.projectName;
  }
  if (key === 'resource.host') {
    return context.resource.runtimeKind === 'kubernetes'
      ? kubeResourceServiceDns(context.resource.id, context.namespaceId)
      : context.resource.hostname;
  }
  if (key === 'resource.name') {
    return context.resource.name;
  }

  throw createInvalidDeployConfigError(`Unsupported resource output template placeholder "${key}".`);
}

function resolveResourceOutputEnvPlaceholder(keyName: string, env: ReadonlyMap<string, string>): string {
  const value: string | undefined = env.get(keyName);
  if (value === undefined) {
    throw createInvalidDeployConfigError(`Resource output template references missing env value "${keyName}".`);
  }

  return value;
}

function createOutputFingerprint(value: string): string {
  return createVariableValueFingerprint(value, getApiConfig().variablesMasterKey);
}
