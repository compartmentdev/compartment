import type { ResolvedCompartmentServiceBuildConfig } from '@compartment/contracts';
import { decryptVariableValueFromStorage } from '../lib/variables-crypto';
import { createInvalidDeployConfigError } from '../errors/api-business-error';
import { getApiConfig } from '../runtime/runtime-access';
import {
  type BuildEnvMap,
  type BuildEnvResolutionOptions,
  type BuildEnvResolutionTarget,
  type BuildEnvSnapshot,
  type BuildEnvSnapshotValue,
} from './deployment-build.types';
import { loadStoredEffectiveVariablesForBuildEnv } from './effective-variables.service';
import type { LoadEffectiveVariablesInput, StoredEffectiveVariable } from './effective-variables.service.types';

export async function buildDeploymentBuildEnvSnapshot(
  build: ResolvedCompartmentServiceBuildConfig,
  environmentId: string,
  organizationId: string,
  projectServiceId: string,
  serviceName: string,
): Promise<BuildEnvSnapshot> {
  return await resolveDeploymentBuildEnvSnapshot(build, {
    environmentId,
    organizationId,
    serviceId: projectServiceId,
    serviceName,
  });
}

export async function resolveDeploymentBuildEnv(
  build: ResolvedCompartmentServiceBuildConfig,
  target: BuildEnvResolutionTarget,
  options: BuildEnvResolutionOptions = { ignoredDescriptorResourceOutputBindingKeyNames: [] },
): Promise<BuildEnvMap> {
  return decryptBuildEnvSnapshot(await resolveDeploymentBuildEnvSnapshot(build, target, options));
}

async function resolveDeploymentBuildEnvSnapshot(
  build: ResolvedCompartmentServiceBuildConfig,
  target: BuildEnvResolutionTarget,
  options: BuildEnvResolutionOptions = { ignoredDescriptorResourceOutputBindingKeyNames: [] },
): Promise<BuildEnvSnapshot> {
  if (build.env.length === 0) {
    return {};
  }

  const effectiveVariablesByKey: Map<string, StoredEffectiveVariable> = await loadEffectiveVariablesByKey(
    target,
    build.env,
    options,
  );

  return buildSelectedBuildEnvSnapshot(build.env, effectiveVariablesByKey, target.serviceName);
}

async function loadEffectiveVariablesByKey(
  target: BuildEnvResolutionTarget,
  keyNames: readonly string[],
  options: BuildEnvResolutionOptions,
): Promise<Map<string, StoredEffectiveVariable>> {
  if (target.environmentId === null || target.organizationId === null) {
    return new Map<string, StoredEffectiveVariable>();
  }

  const effectiveVariables: StoredEffectiveVariable[] = await loadStoredEffectiveVariablesForBuildEnv(
    buildEffectiveVariablesInput(target),
    keyNames,
    options,
  );

  return new Map<string, StoredEffectiveVariable>(
    effectiveVariables.map((variable: StoredEffectiveVariable): [string, StoredEffectiveVariable] => [
      variable.keyName,
      variable,
    ]),
  );
}

function buildEffectiveVariablesInput(target: BuildEnvResolutionTarget): LoadEffectiveVariablesInput {
  return {
    environmentId: target.environmentId!,
    environmentName: '',
    organizationId: target.organizationId!,
    projectName: '',
    targetResourceName: null,
    targetServiceId: target.serviceId,
    targetServiceName: target.serviceName,
    targetType: 'service',
  };
}

function buildSelectedBuildEnvSnapshot(
  keyNames: readonly string[],
  effectiveVariablesByKey: ReadonlyMap<string, StoredEffectiveVariable>,
  serviceName: string,
): BuildEnvSnapshot {
  const buildEnvSnapshot: BuildEnvSnapshot = {};

  for (const keyName of keyNames) {
    const variable: StoredEffectiveVariable = requirePlainBuildVariable(effectiveVariablesByKey, keyName, serviceName);
    buildEnvSnapshot[keyName] = createBuildEnvSnapshotValue(variable);
  }

  return buildEnvSnapshot;
}

function requirePlainBuildVariable(
  effectiveVariablesByKey: ReadonlyMap<string, StoredEffectiveVariable>,
  keyName: string,
  serviceName: string,
): StoredEffectiveVariable {
  const variable: StoredEffectiveVariable | undefined = effectiveVariablesByKey.get(keyName);
  if (variable === undefined) {
    throw createInvalidDeployConfigError(`Build variable "${keyName}" was not found for service "${serviceName}".`);
  }
  if (variable.sourceType === 'resource_output') {
    throwResourceOutputBuildVariableError(keyName);
  }
  if (variable.sensitivity !== 'plain') {
    throw createInvalidDeployConfigError(
      `Build variable "${keyName}" must be plain. Sensitive variables cannot be exposed to build.`,
    );
  }
  if (variable.valueCiphertext === null || variable.encryptionKeyId === null) {
    throw createInvalidDeployConfigError(
      `Build variable "${keyName}" must be a stored variable. Resource output bindings resolve at runtime.`,
    );
  }

  return variable;
}

function throwResourceOutputBuildVariableError(keyName: string): never {
  throw createInvalidDeployConfigError(
    `Build variable "${keyName}" uses a resource output binding. Resource outputs resolve at runtime and cannot be exposed to build.`,
  );
}

function createBuildEnvSnapshotValue(variable: StoredEffectiveVariable): BuildEnvSnapshotValue {
  return {
    encryptionKeyId: variable.encryptionKeyId!,
    valueCiphertext: variable.valueCiphertext!,
  };
}

function decryptBuildEnvSnapshot(buildEnvSnapshot: BuildEnvSnapshot): BuildEnvMap {
  const buildEnv: BuildEnvMap = {};
  const masterKey: Buffer = getApiConfig().variablesMasterKey;

  for (const [keyName, snapshotValue] of Object.entries(buildEnvSnapshot)) {
    buildEnv[keyName] = decryptVariableValueFromStorage(
      snapshotValue.valueCiphertext,
      snapshotValue.encryptionKeyId,
      masterKey,
    );
  }

  return buildEnv;
}
