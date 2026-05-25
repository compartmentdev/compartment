import type { ProjectSummaryListItem } from './projects.service.types';

interface ProjectSummaryListItemSource {
  archivedAt: Date | null;
  createdAt: Date;
  id: string;
  name: string;
  organizationId: string;
  updatedAt: Date;
}

export function buildProjectSummaryListItem(project: ProjectSummaryListItemSource): ProjectSummaryListItem {
  return {
    archivedAt: project.archivedAt,
    createdAt: project.createdAt,
    id: project.id,
    name: project.name,
    organizationId: project.organizationId,
    updatedAt: project.updatedAt,
  };
}
