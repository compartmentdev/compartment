import { readFile } from 'node:fs/promises';
import { isMissingFileSystemEntryError } from '@compartment/utils';
import { selfHostedRuntimeImageRegistrySchema } from '@compartment/contracts';
import type { SafeParseReturnType } from 'zod';
import { writeSelfHostedPrivateFile } from './self-hosted-file-permissions';
import { buildSelfHostedInstallPaths } from './self-hosted-install-paths';
import type { SelfHostedInstallPaths, SelfHostedPathSelection } from './self-hosted-install-paths.types';
import type {
  ManagedDomainInstallState,
  SelfHostedInstallState,
  SelfHostedInstallStateVersion,
} from './self-hosted-install-state.types';
import type { SelfHostedRuntimeImageRegistry } from './self-hosted-env.types';

const selfHostedInstallStateVersion: SelfHostedInstallStateVersion = 1;

type ParsedJsonValue = boolean | number | ParsedJsonObject | ParsedJsonValue[] | string | null;

interface ParsedJsonObject {
  [key: string]: ParsedJsonValue | undefined;
}

interface SelfHostedInstallStateCandidate extends ParsedJsonObject {
  imageRegistry?: ParsedJsonValue | undefined;
  imageSource?: ParsedJsonValue | undefined;
  installationId?: ParsedJsonValue | undefined;
  managedDomain?: ParsedJsonValue | undefined;
  stateVersion?: ParsedJsonValue | undefined;
}

interface ValidSelfHostedInstallStateCandidate extends SelfHostedInstallStateCandidate {
  imageSource: 'registry' | 'local';
  installationId: string;
  stateVersion: SelfHostedInstallStateVersion;
}

type OptionalSelfHostedRuntimeImageRegistry = SelfHostedRuntimeImageRegistry | null | undefined;

export async function readSelfHostedInstallStateFromInstallPaths(
  installPaths: SelfHostedInstallPaths,
): Promise<SelfHostedInstallState | undefined> {
  return await readSelfHostedInstallStateFile(installPaths.statePath, parseSelfHostedInstallState);
}

export async function writeSelfHostedInstallState(
  paths: SelfHostedPathSelection,
  state: SelfHostedInstallState,
  installPaths: SelfHostedInstallPaths = buildSelfHostedInstallPaths(paths),
): Promise<void> {
  await writeSelfHostedPrivateFile(installPaths.statePath, `${JSON.stringify(state, null, 2)}\n`);
}

async function readSelfHostedInstallStateFile<TResult>(
  statePath: string,
  parseState: (stateText: string, statePath: string) => TResult,
): Promise<TResult | undefined> {
  try {
    const stateText: string = await readFile(statePath, 'utf8');
    return parseState(stateText, statePath);
  } catch (error) {
    if (error instanceof Error && isMissingFileSystemEntryError(error)) {
      return undefined;
    }

    throw error;
  }
}

function parseSelfHostedInstallState(stateText: string, statePath: string): SelfHostedInstallState {
  const parsedState: ParsedJsonValue = JSON.parse(stateText) as ParsedJsonValue;
  const state: SelfHostedInstallState | undefined = readCurrentSelfHostedInstallStateValue(parsedState);
  if (state !== undefined) {
    return state;
  }

  throw new Error(`Invalid self-hosted install state in ${statePath}.`);
}

function readCurrentSelfHostedInstallStateValue(value: ParsedJsonValue): SelfHostedInstallState | undefined {
  if (!isSelfHostedInstallStateCandidate(value)) {
    return undefined;
  }

  if (!hasRequiredSelfHostedInstallStateValues(value)) {
    return undefined;
  }

  const managedDomain: ManagedDomainInstallState | null | undefined = readOptionalManagedDomainInstallState(value);
  if (managedDomain === null) {
    return undefined;
  }

  const imageRegistry: OptionalSelfHostedRuntimeImageRegistry = readOptionalSelfHostedRuntimeImageRegistry(value);
  if (imageRegistry === null) {
    return undefined;
  }

  return {
    ...(imageRegistry === undefined ? {} : { imageRegistry }),
    imageSource: value.imageSource,
    installationId: value.installationId,
    ...(managedDomain === undefined ? {} : { managedDomain }),
    stateVersion: selfHostedInstallStateVersion,
  };
}

function hasRequiredSelfHostedInstallStateValues(
  value: SelfHostedInstallStateCandidate,
): value is ValidSelfHostedInstallStateCandidate {
  return (
    value.stateVersion === selfHostedInstallStateVersion &&
    (value.imageSource === 'registry' || value.imageSource === 'local') &&
    typeof value.installationId === 'string' &&
    value.installationId !== ''
  );
}

function readOptionalManagedDomainInstallState(
  value: SelfHostedInstallStateCandidate,
): ManagedDomainInstallState | null | undefined {
  if (value.managedDomain === undefined) {
    return undefined;
  }

  return readManagedDomainInstallState(value.managedDomain) ?? null;
}

function readOptionalSelfHostedRuntimeImageRegistry(
  value: SelfHostedInstallStateCandidate,
): OptionalSelfHostedRuntimeImageRegistry {
  if (value.imageRegistry === undefined) {
    return undefined;
  }

  return readSelfHostedRuntimeImageRegistry(value.imageRegistry) ?? null;
}

function readSelfHostedRuntimeImageRegistry(value: ParsedJsonValue): SelfHostedRuntimeImageRegistry | undefined {
  const result: SafeParseReturnType<SelfHostedRuntimeImageRegistry, SelfHostedRuntimeImageRegistry> =
    selfHostedRuntimeImageRegistrySchema.safeParse(value);
  return result.success ? result.data : undefined;
}

function readManagedDomainInstallState(value: ParsedJsonValue): ManagedDomainInstallState | undefined {
  if (!isParsedJsonObject(value)) {
    return undefined;
  }

  if (
    typeof value.baseDomain !== 'string' ||
    value.baseDomain === '' ||
    typeof value.managedDomainBrokerToken !== 'string' ||
    value.managedDomainBrokerToken === '' ||
    typeof value.acmeEmail !== 'string' ||
    value.acmeEmail === '' ||
    typeof value.brokerUrl !== 'string' ||
    value.brokerUrl === ''
  ) {
    return undefined;
  }

  return {
    acmeEmail: value.acmeEmail,
    baseDomain: value.baseDomain,
    brokerUrl: value.brokerUrl,
    managedDomainBrokerToken: value.managedDomainBrokerToken,
  };
}

function isSelfHostedInstallStateCandidate(value: ParsedJsonValue): value is SelfHostedInstallStateCandidate {
  return isParsedJsonObject(value);
}

function isParsedJsonObject(value: ParsedJsonValue): value is ParsedJsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
