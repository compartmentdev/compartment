import {
  assertValidUnixSocketPath,
  createCompartmentUnixSocketPathPolicy,
  prepareUnixSocketPath,
  restrictUnixSocketPathPermissions,
  type UnixSocketPathPolicy,
} from '@compartment/utils';

const nodeAgentSocketPolicy: UnixSocketPathPolicy = createCompartmentUnixSocketPathPolicy({
  directoryLabel: 'Node agent socket directory',
  socketFileName: 'agent.sock',
  socketSubdirectory: 'node',
  variableName: 'COMPARTMENT_NODE_AGENT_SOCKET',
});

export function prepareNodeAgentSocketPath(socketPath: string): void {
  prepareUnixSocketPath(socketPath, nodeAgentSocketPolicy);
}

export function restrictNodeAgentSocketPathPermissions(socketPath: string): void {
  restrictUnixSocketPathPermissions(socketPath, nodeAgentSocketPolicy);
}

export function assertValidNodeAgentSocketPath(socketPath: string): void {
  assertValidUnixSocketPath(socketPath, nodeAgentSocketPolicy);
}
