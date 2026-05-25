import type { EnvironmentSummary } from '@compartment/contracts';
import type { EnvironmentSummaryInput } from '../../services/presenter.types';

export function buildEnvironmentSummary(environment: EnvironmentSummaryInput): EnvironmentSummary {
  return {
    createdAt: environment.createdAt.toISOString(),
    id: environment.id,
    name: environment.name,
    projectId: environment.projectId,
    updatedAt: environment.updatedAt.toISOString(),
  };
}
