import type { SelectedFields } from 'drizzle-orm/pg-core/query-builders/select.types';
import type { QueryPromise, SQL } from 'drizzle-orm';
import type { AppRouteAccessMode, CompartmentAccessScopeType } from '@compartment/contracts';
import type { Database } from '../db/client';
import type {
  deploymentRoutes,
  deploymentCustomDomains,
  deployments,
  environments,
  organizations,
  projectServices,
  projects,
} from '../db/schema';

export interface DeploymentRouteLookupRow {
  accessMode: AppRouteAccessMode;
  accessScopeId: string;
  accessScopeType: CompartmentAccessScopeType;
  deploymentId: string;
  environmentId: string;
  environmentName: string;
  host: string;
  organizationId: string;
  organizationSlug: string;
  projectId: string;
  projectName: string;
  resolvedRoutesJson: string;
  upstreamHost: string | null;
  upstreamPort: number | null;
  serviceId: string;
  serviceName: string;
}

export interface PersistedDeploymentRouteLookupRow extends Omit<DeploymentRouteLookupRow, 'host'> {
  subdomain: string;
}

export interface PersistedCustomDeploymentRouteLookupRow extends DeploymentRouteLookupRow {
  subdomain: string;
}

export interface DeploymentRouteSubdomainRow {
  subdomain: string;
}

export interface DeploymentRouteLookupSelection extends SelectedFields {
  accessMode: typeof deployments.accessMode;
  accessScopeId: typeof deploymentRoutes.accessScopeId;
  accessScopeType: typeof deploymentRoutes.accessScopeType;
  deploymentId: typeof deploymentRoutes.deploymentId;
  environmentId: typeof environments.id;
  environmentName: typeof environments.name;
  organizationId: typeof organizations.id;
  organizationSlug: typeof organizations.slug;
  projectId: typeof projects.id;
  projectName: typeof projects.name;
  resolvedRoutesJson: typeof deployments.resolvedRoutesJson;
  upstreamHost: SQL<string | null>;
  upstreamPort: SQL<number | null>;
  serviceId: typeof projectServices.id;
  serviceName: typeof projectServices.name;
  subdomain: typeof deploymentRoutes.subdomain;
}

export interface CustomDeploymentRouteLookupSelection extends DeploymentRouteLookupSelection {
  host: typeof deploymentCustomDomains.host;
}

export interface DeploymentRouteOwnerRow {
  environmentId: string;
  serviceId: string;
  subdomain: string;
}

export interface DeploymentRouteOwnerSelection extends SelectedFields {
  environmentId: typeof deployments.environmentId;
  serviceId: typeof deployments.projectServiceId;
  subdomain: typeof deploymentRoutes.subdomain;
}

export interface InsertedDeploymentRouteRow {
  id: string;
}

export type DeploymentRouteLookupFilteredQuery = QueryPromise<PersistedDeploymentRouteLookupRow[]> & {
  limit(limit: number): QueryPromise<PersistedDeploymentRouteLookupRow[]>;
  orderBy(...columns: SQL[]): QueryPromise<PersistedDeploymentRouteLookupRow[]>;
};

export type DeploymentRouteLookupQuery = QueryPromise<PersistedDeploymentRouteLookupRow[]> & {
  where(where: SQL | undefined): DeploymentRouteLookupFilteredQuery;
};

export type CustomDeploymentRouteLookupFilteredQuery = QueryPromise<PersistedCustomDeploymentRouteLookupRow[]> & {
  limit(limit: number): QueryPromise<PersistedCustomDeploymentRouteLookupRow[]>;
  orderBy(...columns: SQL[]): QueryPromise<PersistedCustomDeploymentRouteLookupRow[]>;
};

export type CustomDeploymentRouteLookupQuery = QueryPromise<PersistedCustomDeploymentRouteLookupRow[]> & {
  where(where: SQL | undefined): CustomDeploymentRouteLookupFilteredQuery;
};

export interface UpsertDeploymentRouteInput {
  accessScopeId: string;
  accessScopeType: CompartmentAccessScopeType;
  deploymentId: string;
  environmentId: string;
  id: string;
  serviceId: string;
  subdomain: string;
  updatedAt: Date;
}

export type DeploymentRouteQueryExecutor = Pick<Database, 'insert' | 'select' | 'update'>;
