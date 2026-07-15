import type {
  CompartmentAuthoredResourceConfig,
  CompartmentResourceOperationConfig,
  CompartmentResourceOperationScheduleConfig,
  CompartmentResourceOutputs,
  ResourceEnvSourceSummary,
  ResourceReadinessSummary,
  ResourceVolumeSummary,
} from '@compartment/contracts';
import type { JsonValue } from '@compartment/utils';
import { createInvalidDeployConfigError } from '../errors/api-business-error';
import type { ProjectResourceRow } from '../queries/resources.query.types';
import type { EffectiveVariable } from './effective-variables.service.types';
import type { ResourceRuntimeEnvValue } from './resources.service.helpers';
import {
  buildResourceDefinitionSnapshot,
  parseStoredResourceDefinitionSnapshot,
  type StoredResourceDefinitionSnapshot,
} from './resources.service.storage.snapshot';

export interface StoredResourceEnvSource {
  keyName: string;
  literalValue: string | null;
  sourceType: string;
  variableName: string | null;
}

export interface StoredResourceOperationConfig {
  command: string;
  env: StoredResourceEnvSource[];
  image: string | null;
  schedule: CompartmentResourceOperationScheduleConfig | null;
}

export interface StoredResourceOperationsConfig {
  backup: StoredResourceOperationConfig | null;
  restore: StoredResourceOperationConfig | null;
}

export type { StoredResourceDefinitionSnapshot } from './resources.service.storage.snapshot';

export function serializeResourceEnv(env: StoredResourceEnvSource[]): string {
  return JSON.stringify(env);
}

export function serializeResourceOperations(operations: StoredResourceOperationsConfig): string {
  return JSON.stringify(operations);
}

export function serializeResourceOutputs(outputs: CompartmentResourceOutputs): string {
  return JSON.stringify(outputs);
}

export function serializeResourceVolumes(volumes: ResourceVolumeSummary[]): string {
  return JSON.stringify(volumes);
}

export function serializeResourcePorts(ports: number[]): string {
  return JSON.stringify(ports);
}

export function serializeResourceCommand(command: string[]): string {
  return JSON.stringify(command);
}

export function serializeResourceReadiness(readiness: ResourceReadinessSummary | null): string {
  return JSON.stringify(readiness);
}

export function serializeResourceDefinitionSnapshot(resource: ProjectResourceRow): string {
  return JSON.stringify(buildResourceDefinitionSnapshot(resource));
}

export function parseResourceDefinitionSnapshotJson(value: string | null): StoredResourceDefinitionSnapshot | null {
  if (value === null) {
    return null;
  }

  try {
    return parseStoredResourceDefinitionSnapshot(JSON.parse(value) as JsonValue);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw createInvalidDeployConfigError('Resource backup contains an unsupported resource definition snapshot.');
    }

    throw error;
  }
}

export function parseResourceEnv(row: ProjectResourceRow): ResourceEnvSourceSummary[] {
  return buildResourceEnvSummary(parseStoredResourceEnv(row));
}

export function buildResourceEnvSummary(env: StoredResourceEnvSource[]): ResourceEnvSourceSummary[] {
  return env.map((source: StoredResourceEnvSource): ResourceEnvSourceSummary => {
    assertStoredResourceLiteralEnvSource(source);

    return {
      keyName: source.keyName,
      sourceType: 'literal',
      variableName: null,
    };
  });
}

export function resolveStoredResourceRuntimeEnv(
  row: ProjectResourceRow,
  variables: EffectiveVariable[],
): ResourceRuntimeEnvValue[] {
  return resolveResourceRuntimeEnv(parseStoredResourceEnv(row), variables);
}

export function resolveResourceOperationRuntimeEnv(
  resourceEnv: StoredResourceEnvSource[],
  operation: StoredResourceOperationConfig,
  variables: EffectiveVariable[],
): ResourceRuntimeEnvValue[] {
  const runtimeEnv: Map<string, string> = new Map<string, string>(
    resolveResourceRuntimeEnv(resourceEnv, variables).map((env: ResourceRuntimeEnvValue): [string, string] => [
      env.keyName,
      env.value,
    ]),
  );

  for (const source of operation.env) {
    runtimeEnv.set(source.keyName, resolveStoredResourceEnvValue(source));
  }

  return [...runtimeEnv.entries()].map(
    ([keyName, value]: [string, string]): ResourceRuntimeEnvValue => ({
      keyName,
      value,
    }),
  );
}

export function resolveResourceRuntimeEnv(
  env: StoredResourceEnvSource[],
  variables: EffectiveVariable[],
): ResourceRuntimeEnvValue[] {
  const runtimeEnv: Map<string, string> = new Map<string, string>();

  for (const source of env) {
    runtimeEnv.set(source.keyName, resolveStoredResourceEnvValue(source));
  }
  for (const variable of variables) {
    runtimeEnv.set(variable.keyName, variable.value);
  }

  return [...runtimeEnv.entries()].map(
    ([keyName, value]: [string, string]): ResourceRuntimeEnvValue => ({
      keyName,
      value,
    }),
  );
}

export function parseStoredResourceEnv(row: ProjectResourceRow): StoredResourceEnvSource[] {
  return JSON.parse(row.envJson) as StoredResourceEnvSource[];
}

export function parseStoredResourceOperations(row: ProjectResourceRow): StoredResourceOperationsConfig {
  const operations: Partial<StoredResourceOperationsConfig> = JSON.parse(
    row.operationsJson,
  ) as Partial<StoredResourceOperationsConfig>;

  return {
    backup: normalizeStoredResourceOperation(operations.backup),
    restore: normalizeStoredResourceOperation(operations.restore),
  };
}

export function parseStoredResourceOutputs(row: ProjectResourceRow): CompartmentResourceOutputs {
  return JSON.parse(row.outputsJson ?? '{}') as CompartmentResourceOutputs;
}

export function buildStoredResourceEnv(resource: CompartmentAuthoredResourceConfig): StoredResourceEnvSource[] {
  const entries: [string, string][] = Object.entries(resource.env ?? {});

  return buildStoredResourceEnvFromEntries(entries);
}

export function buildStoredResourceOperations(
  resource: CompartmentAuthoredResourceConfig,
): StoredResourceOperationsConfig {
  return {
    backup: buildStoredResourceOperation(resource.operations?.backup),
    restore: buildStoredResourceOperation(resource.operations?.restore),
  };
}

function buildStoredResourceOperation(
  operation: CompartmentResourceOperationConfig | undefined,
): StoredResourceOperationConfig | null {
  if (operation === undefined) {
    return null;
  }

  return {
    command: operation.command,
    env: buildStoredResourceEnvFromEntries(Object.entries(operation.env ?? {})),
    image: operation.image ?? null,
    schedule: operation.schedule ?? null,
  };
}

function normalizeStoredResourceOperation(
  operation: StoredResourceOperationConfig | null | undefined,
): StoredResourceOperationConfig | null {
  if (operation === null || operation === undefined) {
    return null;
  }

  return {
    command: operation.command,
    env: operation.env,
    image: operation.image,
    schedule: operation.schedule ?? null,
  };
}

function buildStoredResourceEnvFromEntries(entries: [string, string][]): StoredResourceEnvSource[] {
  return entries.map(
    ([keyName, value]: [string, string]): StoredResourceEnvSource => ({
      keyName,
      literalValue: value,
      sourceType: 'literal',
      variableName: null,
    }),
  );
}

export function parseResourceVolumes(row: ProjectResourceRow): ResourceVolumeSummary[] {
  return JSON.parse(row.volumesJson) as ResourceVolumeSummary[];
}

export function parseResourcePorts(row: ProjectResourceRow): number[] {
  return JSON.parse(row.portsJson) as number[];
}

export function parseResourceCommand(row: ProjectResourceRow): string[] {
  return JSON.parse(row.commandJson) as string[];
}

export function parseResourceReadiness(row: ProjectResourceRow): ResourceReadinessSummary | null {
  return JSON.parse(row.readinessJson) as ResourceReadinessSummary | null;
}

function resolveStoredResourceEnvValue(env: StoredResourceEnvSource): string {
  assertStoredResourceLiteralEnvSource(env);

  return env.literalValue ?? '';
}

function assertStoredResourceLiteralEnvSource(env: StoredResourceEnvSource): void {
  if (env.sourceType === 'literal') {
    return;
  }

  throw createInvalidDeployConfigError(
    `Resource environment ${env.keyName} uses unsupported legacy source type ${env.sourceType}. Resource descriptor env is literal-only; move secrets to resource-scoped variables.`,
  );
}
