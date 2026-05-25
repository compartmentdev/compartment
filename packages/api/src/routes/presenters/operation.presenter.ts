import type { OperationSummary } from '@compartment/contracts';
import type { OperationSummaryInput } from '../../services/presenter.types';
import { toNullableIsoString } from './date.presenter';

export function buildOperationSummary(operation: OperationSummaryInput): OperationSummary {
  return {
    completedAt: toNullableIsoString(operation.completedAt),
    createdAt: operation.createdAt.toISOString(),
    id: operation.id,
    status: operation.status,
    targetId: operation.targetId,
    targetType: operation.targetType,
    type: operation.type,
  };
}
