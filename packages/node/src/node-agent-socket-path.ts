import {
  assertValidUnixSocketPath,
  createCompartmentUnixSocketPathPolicy,
  prepareUnixSocketPath,
  restrictUnixSocketPathPermissions,
  type UnixSocketPathPolicy,
} from '@compartment/utils';

export function prepareNodeAgentSocketPath(socketPath: string, runtimeGid: number | null): void {
  prepareUnixSocketPath(socketPath, createNodeAgentSocketPolicy(runtimeGid));
}

export function restrictNodeAgentSocketPathPermissions(socketPath: string, runtimeGid: number | null): void {
  restrictUnixSocketPathPermissions(socketPath, createNodeAgentSocketPolicy(runtimeGid));
}

export function assertValidNodeAgentSocketPath(socketPath: string): void {
  assertValidUnixSocketPath(socketPath, createNodeAgentSocketPolicy(null));
}

function createNodeAgentSocketPolicy(runtimeGid: number | null): UnixSocketPathPolicy {
  return createCompartmentUnixSocketPathPolicy({
    directoryLabel: 'Node agent socket directory',
    directoryMode: runtimeGid === null ? 0o700 : 0o750,
    ...(runtimeGid === null ? {} : { owner: { uid: 0, gid: runtimeGid } }),
    socketFileName: 'agent.sock',
    socketMode: runtimeGid === null ? 0o600 : 0o660,
    socketSubdirectory: 'node',
    variableName: 'COMPARTMENT_NODE_AGENT_SOCKET',
  });
}
