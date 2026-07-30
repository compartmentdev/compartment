import { eq, sql } from 'drizzle-orm';
import { dataMigrationMarkers, environmentVariableValues, organizationVariableSetEntries } from '../db/schema';
import { buildArtifacts } from '../db/schema-deploy';
import { productJobRuns } from '../db/schema-kube-runtime';
import { projectResources, resourceBackups, resourceReconcileRuns } from '../db/schema-resources';
import type {
  TenantSecretMigrationExecutor,
  PersistedTenantSecretRow,
  TenantSecretStorageRow,
  TenantSecretStorageUpdate,
  TenantSecretJsonStorageRow,
  TenantSecretJsonStorage,
  PersistedTenantSecretJsonRow,
} from './tenant-secret-migration.query.types';

export { updateTenantSecretJsonStorageRow } from './tenant-secret-json-migration.query';

export async function claimTenantSecretMigrationMarker(
  executor: TenantSecretMigrationExecutor,
  markerId: string,
): Promise<boolean> {
  const recorded: { id: string }[] = await executor
    .insert(dataMigrationMarkers)
    .values({ id: markerId })
    .onConflictDoNothing()
    .returning({ id: dataMigrationMarkers.id });
  return recorded.length === 1;
}

export async function listTenantSecretStorageRows(
  executor: TenantSecretMigrationExecutor,
): Promise<TenantSecretStorageRow[]> {
  const [environmentRows, variableSetRows]: [PersistedTenantSecretRow[], PersistedTenantSecretRow[]] =
    await Promise.all([listEnvironmentTenantSecretRows(executor), listVariableSetTenantSecretRows(executor)]);

  return [
    ...environmentRows.map(
      (row: PersistedTenantSecretRow): TenantSecretStorageRow => ({
        ...row,
        storage: 'environment_variable_values',
      }),
    ),
    ...variableSetRows.map(
      (row: PersistedTenantSecretRow): TenantSecretStorageRow => ({
        ...row,
        storage: 'organization_variable_set_entries',
      }),
    ),
  ];
}

export async function listTenantSecretJsonStorageRows(
  executor: TenantSecretMigrationExecutor,
): Promise<TenantSecretJsonStorageRow[]> {
  const [artifactRows, resourceEnvRows, resourceOperationRows, productRows, backupRows, reconcileRows, rollbackRows] =
    await Promise.all([
      listBuildArtifactJsonRows(executor),
      listProjectResourceEnvJsonRows(executor),
      listProjectResourceOperationJsonRows(executor),
      listProductJobJsonRows(executor),
      listResourceBackupJsonRows(executor),
      listResourceReconcileJsonRows(executor),
      listResourceRollbackJsonRows(executor),
    ]);
  return [
    ...tagJsonRows(artifactRows, 'build_artifacts'),
    ...tagJsonRows(resourceEnvRows, 'project_resources_env'),
    ...tagJsonRows(resourceOperationRows, 'project_resources_operations'),
    ...tagJsonRows(productRows, 'product_job_runs'),
    ...tagJsonRows(backupRows, 'resource_backups'),
    ...tagJsonRows(reconcileRows, 'resource_reconcile_runs'),
    ...tagJsonRows(rollbackRows, 'resource_reconcile_rollbacks'),
  ];
}

function tagJsonRows(
  rows: PersistedTenantSecretJsonRow[],
  storage: TenantSecretJsonStorage,
): TenantSecretJsonStorageRow[] {
  return rows.map((row: PersistedTenantSecretJsonRow): TenantSecretJsonStorageRow => ({ ...row, storage }));
}

async function listBuildArtifactJsonRows(
  executor: TenantSecretMigrationExecutor,
): Promise<PersistedTenantSecretJsonRow[]> {
  return await executor
    .select({ id: buildArtifacts.id, json: buildArtifacts.resolvedBuildEnvJson })
    .from(buildArtifacts);
}

async function listProjectResourceEnvJsonRows(
  executor: TenantSecretMigrationExecutor,
): Promise<PersistedTenantSecretJsonRow[]> {
  return await executor.select({ id: projectResources.id, json: projectResources.envJson }).from(projectResources);
}

async function listProjectResourceOperationJsonRows(
  executor: TenantSecretMigrationExecutor,
): Promise<PersistedTenantSecretJsonRow[]> {
  return await executor
    .select({ id: projectResources.id, json: projectResources.operationsJson })
    .from(projectResources);
}

async function listProductJobJsonRows(
  executor: TenantSecretMigrationExecutor,
): Promise<PersistedTenantSecretJsonRow[]> {
  return await executor.select({ id: productJobRuns.id, json: productJobRuns.envJson }).from(productJobRuns);
}

async function listResourceBackupJsonRows(
  executor: TenantSecretMigrationExecutor,
): Promise<PersistedTenantSecretJsonRow[]> {
  const rows: { id: string; json: string | null }[] = await executor
    .select({ id: resourceBackups.id, json: resourceBackups.resourceDefinitionJson })
    .from(resourceBackups)
    .where(sql`${resourceBackups.resourceDefinitionJson} IS NOT NULL`);
  return requirePersistedJsonRows(rows);
}

async function listResourceReconcileJsonRows(
  executor: TenantSecretMigrationExecutor,
): Promise<PersistedTenantSecretJsonRow[]> {
  return await executor
    .select({ id: resourceReconcileRuns.id, json: resourceReconcileRuns.intentJson })
    .from(resourceReconcileRuns);
}

async function listResourceRollbackJsonRows(
  executor: TenantSecretMigrationExecutor,
): Promise<PersistedTenantSecretJsonRow[]> {
  const rows: { id: string; json: string | null }[] = await executor
    .select({ id: resourceReconcileRuns.id, json: resourceReconcileRuns.previousManifestJson })
    .from(resourceReconcileRuns)
    .where(sql`${resourceReconcileRuns.previousManifestJson} IS NOT NULL`);
  return requirePersistedJsonRows(rows);
}

function requirePersistedJsonRows(rows: { id: string; json: string | null }[]): PersistedTenantSecretJsonRow[] {
  return rows.map((row: { id: string; json: string | null }): PersistedTenantSecretJsonRow => {
    if (row.json === null) {
      throw new Error(`Tenant secret JSON row ${row.id} unexpectedly contains null.`);
    }
    return { id: row.id, json: row.json };
  });
}

async function listEnvironmentTenantSecretRows(
  executor: TenantSecretMigrationExecutor,
): Promise<PersistedTenantSecretRow[]> {
  return await executor
    .select({
      encryptionKeyId: environmentVariableValues.encryptionKeyId,
      id: environmentVariableValues.id,
      valueCiphertext: environmentVariableValues.valueCiphertext,
    })
    .from(environmentVariableValues);
}

async function listVariableSetTenantSecretRows(
  executor: TenantSecretMigrationExecutor,
): Promise<PersistedTenantSecretRow[]> {
  return await executor
    .select({
      encryptionKeyId: organizationVariableSetEntries.encryptionKeyId,
      id: organizationVariableSetEntries.id,
      valueCiphertext: organizationVariableSetEntries.valueCiphertext,
    })
    .from(organizationVariableSetEntries);
}

export async function updateTenantSecretStorageRow(
  executor: TenantSecretMigrationExecutor,
  update: TenantSecretStorageUpdate,
): Promise<void> {
  if (update.storage === 'environment_variable_values') {
    await executor
      .update(environmentVariableValues)
      .set({
        encryptionKeyId: update.encryptionKeyId,
        valueCiphertext: update.valueCiphertext,
        updatedAt: new Date(),
      })
      .where(eq(environmentVariableValues.id, update.id));
    return;
  }

  await executor
    .update(organizationVariableSetEntries)
    .set({
      encryptionKeyId: update.encryptionKeyId,
      valueCiphertext: update.valueCiphertext,
      updatedAt: new Date(),
    })
    .where(eq(organizationVariableSetEntries.id, update.id));
}
