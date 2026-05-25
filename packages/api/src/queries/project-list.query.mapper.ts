import type { ProjectListPageQueryRow, ProjectListRowsPage } from './project-list.query.types';
import type { ProjectRow } from './projects.query.types';

type ProjectListPageProjectQueryRow = Extract<ProjectListPageQueryRow, { projectId: string }>;

export function toProjectListRowsPage(rows: ProjectListPageQueryRow[]): ProjectListRowsPage {
  const firstRow: ProjectListPageQueryRow | undefined = rows[0];
  if (firstRow === undefined) {
    throw new Error('Expected project list page query row.');
  }

  return {
    pagination: {
      page: firstRow.page,
      perPage: firstRow.perPage,
      totalItems: firstRow.totalItems,
      totalPages: firstRow.totalPages,
    },
    projects: rows.filter(isProjectListPageProjectQueryRow).map(toProjectRow),
  };
}

function isProjectListPageProjectQueryRow(row: ProjectListPageQueryRow): row is ProjectListPageProjectQueryRow {
  return row.projectId !== null;
}

function toProjectRow(row: ProjectListPageProjectQueryRow): ProjectRow {
  return {
    archivedAt: toNullableProjectPageDate(row.archivedAt),
    createdAt: toProjectPageDateValue(row.createdAt),
    id: row.projectId,
    name: row.projectName,
    organizationId: row.organizationId,
    updatedAt: toProjectPageDateValue(row.updatedAt),
  };
}

function toNullableProjectPageDate(value: Date | string | null): Date | null {
  return value === null ? null : toProjectPageDateValue(value);
}

function toProjectPageDateValue(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}
