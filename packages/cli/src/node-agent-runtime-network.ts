import { createNodeRequester, reconcileNodeRuntimeNetworks } from '@compartment/sdk';
import { readRequiredSelfHostedEnvironmentValue, readSelfHostedEnvironmentValues } from './self-hosted-env-file';
import { readCanonicalNodeAgentSocketPath } from './self-hosted-host-socket-paths';

interface NodeAgentRuntimeNetworkReconcileInput {
  environmentText: string;
}

interface NodeAgentRuntimeNetworkReconcileConfig {
  internalToken: string;
  nodeSocketPath: string;
}

export function assertNodeAgentRuntimeNetworkReconcileEnvironment(environmentText: string): void {
  readNodeAgentRuntimeNetworkReconcileConfig(environmentText);
}

export async function reconcileNodeAgentRuntimeNetworks(input: NodeAgentRuntimeNetworkReconcileInput): Promise<void> {
  await reconcileNodeRuntimeNetworks(
    createNodeRequester(readNodeAgentRuntimeNetworkReconcileConfig(input.environmentText)),
  );
}

function readNodeAgentRuntimeNetworkReconcileConfig(environmentText: string): NodeAgentRuntimeNetworkReconcileConfig {
  const environmentValues: Record<string, string> = readSelfHostedEnvironmentValues(environmentText);

  return {
    internalToken: readRequiredSelfHostedEnvironmentValue(environmentValues, 'COMPARTMENT_RUNTIME_CONTROL_TOKEN'),
    nodeSocketPath: readCanonicalNodeAgentSocketPath(environmentValues),
  };
}
