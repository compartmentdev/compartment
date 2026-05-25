import { createNodeRequester, type NodeRequester } from '@compartment/sdk';
import { getApiConfig } from '../runtime/runtime-access';

export function createNodeRuntimeRequester(nodeSocketPath: string, requestTimeoutMs?: number): NodeRequester {
  return createNodeRequester({
    internalToken: getApiConfig().runtimeControlToken,
    nodeSocketPath,
    requestTimeoutMs,
  });
}
