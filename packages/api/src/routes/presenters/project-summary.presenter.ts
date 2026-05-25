import type { ProjectSummary } from '@compartment/contracts';
import type { ProjectSummaryInput } from '../../services/presenter.types';

export function buildProjectSummary(project: ProjectSummaryInput): ProjectSummary {
  return {
    archivedAt: project.archivedAt?.toISOString() ?? null,
    createdAt: project.createdAt.toISOString(),
    id: project.id,
    name: project.name,
    organizationId: project.organizationId,
    updatedAt: project.updatedAt.toISOString(),
  };
}
