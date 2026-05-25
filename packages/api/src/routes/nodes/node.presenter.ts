import type { NodeSummary } from '@compartment/contracts';
import type { NodeSummaryInput } from '../../services/presenter.types';

export function buildNodeSummary(node: NodeSummaryInput): NodeSummary {
  return {
    id: node.id,
    name: node.name,
    nodeSocketPath: node.nodeSocketPath,
    nodeVersion: node.nodeVersion,
  };
}
