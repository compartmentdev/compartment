import type { ApiDatabaseTransaction } from '../db/client.types';
import type { AppRouteAccessMode } from '@compartment/contracts';
import type { Database } from '../db/client';
import type { projects } from '../db/schema';

export type ProjectsMutationTransaction = ApiDatabaseTransaction;
export type ProjectsReadExecutor = Pick<Database, 'select'>;
export type ProjectsWriteExecutor = Database | ApiDatabaseTransaction;
export type PersistedProjectRow = typeof projects.$inferSelect;

export interface ProjectRow {
  archivedAt: Date | null;
  createdAt: Date;
  defaultAccessMode: AppRouteAccessMode;
  id: string;
  name: string;
  organizationId: string;
  updatedAt: Date;
}

export interface CreateProjectInput {
  defaultAccessMode: AppRouteAccessMode;
  id: string;
  name: string;
  organizationId: string;
  updatedAt: Date;
}

export interface RenameProjectInput {
  name: string;
  organizationId: string;
  projectId: string;
  updatedAt: Date;
}

export interface SetProjectArchivedAtInput {
  archivedAt: Date | null;
  organizationId: string;
  projectId: string;
  updatedAt: Date;
}
