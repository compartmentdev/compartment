import {
  assertValidUnixSocketPath,
  createCompartmentUnixSocketPathPolicy,
  type UnixSocketPathPolicy,
} from '@compartment/utils';
import { defaultNodeAgentSocketPath, defaultSystemApiSocketPath } from './self-hosted-env';
import { readRequiredSelfHostedEnvironmentValue } from './self-hosted-env-file';

type SelfHostedHostSocketVariableName = 'COMPARTMENT_NODE_AGENT_SOCKET' | 'COMPARTMENT_SYSTEM_API_SOCKET';

const legacySystemApiSocketPath: string = '/var/run/compartment/system-api.sock';

const nodeAgentSocketPolicy: UnixSocketPathPolicy = createCompartmentUnixSocketPathPolicy({
  directoryLabel: 'Node agent socket directory',
  socketFileName: 'agent.sock',
  socketSubdirectory: 'node',
  variableName: 'COMPARTMENT_NODE_AGENT_SOCKET',
});
const systemApiSocketPolicy: UnixSocketPathPolicy = createCompartmentUnixSocketPathPolicy({
  directoryLabel: 'System API socket directory',
  socketFileName: 'system-api.sock',
  socketSubdirectory: 'api',
  variableName: 'COMPARTMENT_SYSTEM_API_SOCKET',
});

export function readMigratedNodeAgentSocketPath(environmentValues: Record<string, string>): string {
  if (environmentValues.COMPARTMENT_NODE_AGENT_SOCKET === undefined) {
    return defaultNodeAgentSocketPath;
  }

  return readCanonicalNodeAgentSocketPath(environmentValues);
}

export function readCanonicalNodeAgentSocketPath(environmentValues: Record<string, string>): string {
  return readCanonicalSelfHostedHostSocketPath(
    environmentValues,
    'COMPARTMENT_NODE_AGENT_SOCKET',
    defaultNodeAgentSocketPath,
  );
}

export function readMigratedSystemApiSocketPath(environmentValues: Record<string, string>): string {
  const socketPath: string = readRequiredSelfHostedEnvironmentValue(environmentValues, 'COMPARTMENT_SYSTEM_API_SOCKET');
  if (socketPath === legacySystemApiSocketPath) {
    return defaultSystemApiSocketPath;
  }

  return readCanonicalSystemApiSocketPath(environmentValues);
}

export function readCanonicalSystemApiSocketPath(environmentValues: Record<string, string>): string {
  return readCanonicalSelfHostedHostSocketPath(
    environmentValues,
    'COMPARTMENT_SYSTEM_API_SOCKET',
    defaultSystemApiSocketPath,
  );
}

function readCanonicalSelfHostedHostSocketPath(
  environmentValues: Record<string, string>,
  variableName: SelfHostedHostSocketVariableName,
  canonicalSocketPath: string,
): string {
  const socketPath: string = readRequiredSelfHostedEnvironmentValue(environmentValues, variableName);
  assertValidUnixSocketPath(socketPath, readSelfHostedHostSocketPathPolicy(variableName));
  if (socketPath !== canonicalSocketPath) {
    throw new Error(
      `The self-hosted environment has unsupported ${variableName} value ${socketPath}. Expected ${canonicalSocketPath}.`,
    );
  }

  return canonicalSocketPath;
}

function readSelfHostedHostSocketPathPolicy(variableName: SelfHostedHostSocketVariableName): UnixSocketPathPolicy {
  switch (variableName) {
    case 'COMPARTMENT_NODE_AGENT_SOCKET':
      return nodeAgentSocketPolicy;
    case 'COMPARTMENT_SYSTEM_API_SOCKET':
      return systemApiSocketPolicy;
  }
}
