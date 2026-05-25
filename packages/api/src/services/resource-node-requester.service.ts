import type { NodeRequester } from '@compartment/sdk';
import type { NodeRow } from '../queries/node.query.types';
import { createNodeRuntimeRequester } from './node-runtime-requester';
import { resolveResourceNode } from './resources-node.service';
import type { ResourceEnvironmentContext } from './resources.service.types';

const resourceNodeRequestTimeoutMs: number = 15 * 60 * 1000;

export async function createResourceNodeRequester(context: ResourceEnvironmentContext): Promise<NodeRequester> {
  const node: NodeRow = await resolveResourceNode(context);

  return createNodeRuntimeRequester(node.nodeSocketPath, resourceNodeRequestTimeoutMs);
}
