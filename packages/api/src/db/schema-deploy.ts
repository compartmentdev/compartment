import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  type PgTableExtraConfig,
  unique,
} from 'drizzle-orm/pg-core';
import { defaultApplicationPorts, defaultAppRouteAccessMode } from '@compartment/contracts';
import { organizations, principals } from './schema-core';
import { environments, operations, projectServices, projects } from './schema-platform';
import { sourceUploads } from './schema-source-uploads';
import type * as DeploySchemaTypes from './schema-deploy.types';

export const buildArtifacts: DeploySchemaTypes.BuildArtifactsTable = pgTable(
  'build_artifacts',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references((): typeof projects.id => projects.id, { onDelete: 'cascade' }),
    projectServiceId: text('project_service_id')
      .notNull()
      .references((): typeof projectServices.id => projectServices.id, { onDelete: 'cascade' }),
    createdByPrincipalId: text('created_by_principal_id').references((): typeof principals.id => principals.id, {
      onDelete: 'set null',
    }),
    sourceUploadId: text('source_upload_id').references((): typeof sourceUploads.id => sourceUploads.id, {
      onDelete: 'set null',
    }),
    sourceDigest: text('source_digest').notNull(),
    resolvedBuildJson: text('resolved_build_json').notNull(),
    resolvedBuildEnvJson: text('resolved_build_env_json').notNull(),
    imageRepository: text('image_repository').notNull(),
    imageRef: text('image_ref'),
    imageRetentionState: text('image_retention_state', { enum: ['available', 'cleaned'] })
      .default('available')
      .notNull(),
    imageCleanedAt: timestamp('image_cleaned_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table: DeploySchemaTypes.BuildArtifactsExtraConfigColumns): PgTableExtraConfig => ({
    sourceUploadIdIndex: index('build_artifacts_source_upload_id_idx').on(table.sourceUploadId),
  }),
);

function buildDeploymentSourceProvenanceColumns(): DeploySchemaTypes.DeploymentSourceProvenanceColumnBuilders {
  return {
    sourceAutomationPrincipalId: text('source_automation_principal_id'),
    sourceBindingId: text('source_binding_id'),
    sourceBindingSnapshotJson: text('source_binding_snapshot_json'),
    sourceCommitSha: text('source_commit_sha'),
    sourceEventId: text('source_event_id'),
    sourceId: text('source_id'),
    sourceKind: text('source_kind'),
    sourceRepositorySnapshotJson: text('source_repository_snapshot_json'),
    sourceResolutionTaskId: text('source_resolution_task_id'),
  };
}

export const deploymentRuns: DeploySchemaTypes.DeploymentRunsTable = pgTable(
  'deployment_runs',
  {
    id: text('id').primaryKey(),
    environmentId: text('environment_id')
      .notNull()
      .references((): typeof environments.id => environments.id, { onDelete: 'cascade' }),
    label: text('label'),
    onboardingSessionId: text('onboarding_session_id'),
    triggerType: text('trigger_type').notNull(),
    ...buildDeploymentSourceProvenanceColumns(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table: DeploySchemaTypes.DeploymentRunsExtraConfigColumns): PgTableExtraConfig => ({
    environmentCreatedAtIndex: index('deployment_runs_environment_created_at_idx').on(
      table.environmentId,
      table.createdAt,
    ),
    onboardingSessionCreatedAtIndex: index('deployment_runs_onboarding_session_created_at_idx').on(
      table.onboardingSessionId,
      table.createdAt,
    ),
  }),
);

export const deployments: DeploySchemaTypes.DeploymentsTable = pgTable(
  'deployments',
  {
    id: text('id').primaryKey(),
    deploymentRunId: text('deployment_run_id')
      .notNull()
      .references((): typeof deploymentRuns.id => deploymentRuns.id, { onDelete: 'cascade' }),
    environmentId: text('environment_id')
      .notNull()
      .references((): typeof environments.id => environments.id, { onDelete: 'cascade' }),
    buildArtifactId: text('build_artifact_id')
      .notNull()
      .references((): typeof buildArtifacts.id => buildArtifacts.id, { onDelete: 'cascade' }),
    projectServiceId: text('project_service_id')
      .notNull()
      .references((): typeof projectServices.id => projectServices.id, { onDelete: 'cascade' }),
    operationId: text('operation_id')
      .notNull()
      .references((): typeof operations.id => operations.id, { onDelete: 'cascade' }),
    status: text('status').notNull(),
    health: text('health').notNull(),
    label: text('label'),
    failureMessage: text('failure_message'),
    accessMode: text('access_mode', { enum: ['authenticated', 'public'] })
      .default(defaultAppRouteAccessMode)
      .notNull(),
    isActive: boolean('is_active').default(false).notNull(),
    resolvedPortsJson: text('resolved_ports_json').default(JSON.stringify(defaultApplicationPorts)).notNull(),
    resolvedReadinessJson: text('resolved_readiness_json').notNull(),
    resolvedReleaseJson: text('resolved_release_json').default('null').notNull(),
    resolvedRunJson: text('resolved_run_json').notNull(),
    resolvedRoutesJson: text('resolved_routes_json').default('[]').notNull(),
    promotionStage: text('promotion_stage').notNull(),
    movementSourceDeploymentId: text('movement_source_deployment_id').references(
      (): typeof deployments.id => deployments.id,
      {
        onDelete: 'set null',
      },
    ),
    ...buildDeploymentSourceProvenanceColumns(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table: DeploySchemaTypes.DeploymentsExtraConfigColumns): PgTableExtraConfig => ({
    movementLookupIndex: index('deployments_movement_lookup_idx').on(
      table.environmentId,
      table.projectServiceId,
      table.status,
      table.movementSourceDeploymentId,
    ),
    queueClaimOrderIndex: index('deployments_status_created_at_id_idx').on(table.status, table.createdAt, table.id),
  }),
);

export const deploymentRunEvents: DeploySchemaTypes.DeploymentRunEventsTable = pgTable(
  'deployment_run_events',
  {
    id: text('id').primaryKey(),
    deploymentRunId: text('deployment_run_id')
      .notNull()
      .references((): typeof deploymentRuns.id => deploymentRuns.id, { onDelete: 'cascade' }),
    deploymentId: text('deployment_id').references((): typeof deployments.id => deployments.id, {
      onDelete: 'cascade',
    }),
    stepKey: text('step_key').notNull(),
    status: text('status'),
    stream: text('stream').notNull(),
    level: text('level').notNull(),
    message: text('message').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table: DeploySchemaTypes.DeploymentRunEventsExtraConfigColumns): PgTableExtraConfig => ({
    runCreatedAtIndex: index('deployment_run_events_run_created_at_idx').on(table.deploymentRunId, table.createdAt),
    deploymentCreatedAtIndex: index('deployment_run_events_deployment_created_at_idx').on(
      table.deploymentId,
      table.createdAt,
    ),
  }),
);

export const deploymentMovementOrganizationState: DeploySchemaTypes.DeploymentMovementOrganizationStateTable = pgTable(
  'deployment_movement_organization_state',
  {
    organizationId: text('organization_id')
      .primaryKey()
      .references((): typeof organizations.id => organizations.id, { onDelete: 'cascade' }),
    lastClaimedAt: timestamp('last_claimed_at', { withTimezone: true }).notNull(),
  },
  (table: DeploySchemaTypes.DeploymentMovementOrganizationStateExtraConfigColumns): PgTableExtraConfig => ({
    lastClaimedAtIndex: index('deployment_movement_org_state_last_claimed_at_idx').on(table.lastClaimedAt),
  }),
);

export const deploymentRoutes: DeploySchemaTypes.DeploymentRoutesTable = pgTable('deployment_routes', {
  id: text('id').primaryKey(),
  deploymentId: text('deployment_id')
    .notNull()
    .references((): typeof deployments.id => deployments.id, { onDelete: 'cascade' })
    .unique(),
  subdomain: text('subdomain').notNull().unique(),
  accessScopeType: text('access_scope_type', { enum: ['organization', 'project', 'environment'] }).notNull(),
  accessScopeId: text('access_scope_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const deploymentCustomDomains: DeploySchemaTypes.DeploymentCustomDomainsTable = pgTable(
  'deployment_custom_domains',
  {
    id: text('id').primaryKey(),
    environmentId: text('environment_id')
      .notNull()
      .references((): typeof environments.id => environments.id, { onDelete: 'cascade' }),
    projectServiceId: text('project_service_id')
      .notNull()
      .references((): typeof projectServices.id => projectServices.id, { onDelete: 'cascade' }),
    host: text('host').notNull().unique(),
    verificationTokenHash: text('verification_token_hash').notNull(),
    ownershipStatus: text('ownership_status', { enum: ['pending', 'valid', 'invalid'] }).notNull(),
    routingStatus: text('routing_status', { enum: ['pending', 'valid', 'invalid'] }).notNull(),
    reconcileState: text('reconcile_state', {
      enum: ['pending', 'reconciling', 'active', 'failed', 'deleting'],
    })
      .default('pending')
      .notNull(),
    desiredGeneration: integer('desired_generation').default(1).notNull(),
    observedGeneration: integer('observed_generation').default(0).notNull(),
    observedIngressPresent: boolean('observed_ingress_present').default(false).notNull(),
    observedCertificatePresent: boolean('observed_certificate_present').default(false).notNull(),
    observedCertificateReady: boolean('observed_certificate_ready').default(false).notNull(),
    edgeRoutingEnabled: boolean('edge_routing_enabled').default(false).notNull(),
    deletionReady: boolean('deletion_ready').default(false).notNull(),
    reconcileLeaseId: text('reconcile_lease_id'),
    reconcileLeaseExpiresAt: timestamp('reconcile_lease_expires_at', { withTimezone: true }),
    lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    failureMessage: text('failure_message'),
    createdByPrincipalId: text('created_by_principal_id').references((): typeof principals.id => principals.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table: DeploySchemaTypes.DeploymentCustomDomainsExtraConfigColumns): PgTableExtraConfig => ({
    ownerHostUnique: unique('deployment_custom_domains_env_id_service_id_host_unique').on(
      table.environmentId,
      table.projectServiceId,
      table.host,
    ),
  }),
);
