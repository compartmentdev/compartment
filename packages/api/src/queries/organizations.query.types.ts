import type { Database } from '../db/client';
import type { ApiDatabaseTransaction } from '../db/client.types';

export interface OrganizationRow {
  id: string;
  name: string;
  slug: string;
}

export interface CreateOrganizationInput {
  id: string;
  name: string;
  slug: string;
}

export type OrganizationCreationTransaction = ApiDatabaseTransaction;
export type OrganizationQueryExecutor = Database | OrganizationCreationTransaction;
