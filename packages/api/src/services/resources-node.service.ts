import { createInvalidDeployConfigError } from '../errors/api-business-error';
import { findNodeById } from '../queries/node.query';
import type { NodeRow } from '../queries/node.query.types';
import type { ResourceEnvironmentContext } from './resources.service.types';

export async function resolveResourceNode(context: ResourceEnvironmentContext): Promise<NodeRow> {
  const node: NodeRow | undefined = await findNodeById(context.environment.nodeId);
  if (node === undefined) {
    throw createInvalidDeployConfigError('Resource environment node is not available.');
  }

  return node;
}
