import { eq } from 'drizzle-orm';
import { buildArtifacts } from '../db/schema-deploy';
import { productJobRuns } from '../db/schema-kube-runtime';
import { projectResources, resourceBackups, resourceReconcileRuns } from '../db/schema-resources';
import type { TenantSecretJsonStorageRow, TenantSecretMigrationExecutor } from './tenant-secret-migration.query.types';

type TenantSecretJsonUpdater = (
  executor: TenantSecretMigrationExecutor,
  row: TenantSecretJsonStorageRow,
) => Promise<void>;

class TenantSecretJsonUpdaterRegistry {
  public readonly build_artifacts: TenantSecretJsonUpdater = updateBuildArtifactJson;
  public readonly product_job_runs: TenantSecretJsonUpdater = updateProductJobJson;
  public readonly project_resources_env: TenantSecretJsonUpdater = updateProjectResourceEnvJson;
  public readonly project_resources_operations: TenantSecretJsonUpdater = updateProjectResourceOperationJson;
  public readonly resource_backups: TenantSecretJsonUpdater = updateResourceBackupJson;
  public readonly resource_reconcile_rollbacks: TenantSecretJsonUpdater = updateResourceRollbackJson;
  public readonly resource_reconcile_runs: TenantSecretJsonUpdater = updateResourceReconcileJson;
}

const tenantSecretJsonUpdaters: TenantSecretJsonUpdaterRegistry = new TenantSecretJsonUpdaterRegistry();

export async function updateTenantSecretJsonStorageRow(
  executor: TenantSecretMigrationExecutor,
  row: TenantSecretJsonStorageRow,
): Promise<void> {
  await tenantSecretJsonUpdaters[row.storage](executor, row);
}

async function updateBuildArtifactJson(
  executor: TenantSecretMigrationExecutor,
  row: TenantSecretJsonStorageRow,
): Promise<void> {
  await executor
    .update(buildArtifacts)
    .set({ resolvedBuildEnvJson: row.json, updatedAt: new Date() })
    .where(eq(buildArtifacts.id, row.id));
}

async function updateProductJobJson(
  executor: TenantSecretMigrationExecutor,
  row: TenantSecretJsonStorageRow,
): Promise<void> {
  await executor
    .update(productJobRuns)
    .set({ envJson: row.json, updatedAt: new Date() })
    .where(eq(productJobRuns.id, row.id));
}

async function updateProjectResourceEnvJson(
  executor: TenantSecretMigrationExecutor,
  row: TenantSecretJsonStorageRow,
): Promise<void> {
  await executor
    .update(projectResources)
    .set({ envJson: row.json, updatedAt: new Date() })
    .where(eq(projectResources.id, row.id));
}

async function updateProjectResourceOperationJson(
  executor: TenantSecretMigrationExecutor,
  row: TenantSecretJsonStorageRow,
): Promise<void> {
  await executor
    .update(projectResources)
    .set({ operationsJson: row.json, updatedAt: new Date() })
    .where(eq(projectResources.id, row.id));
}

async function updateResourceBackupJson(
  executor: TenantSecretMigrationExecutor,
  row: TenantSecretJsonStorageRow,
): Promise<void> {
  await executor
    .update(resourceBackups)
    .set({ resourceDefinitionJson: row.json })
    .where(eq(resourceBackups.id, row.id));
}

async function updateResourceRollbackJson(
  executor: TenantSecretMigrationExecutor,
  row: TenantSecretJsonStorageRow,
): Promise<void> {
  await executor
    .update(resourceReconcileRuns)
    .set({ previousManifestJson: row.json, updatedAt: new Date() })
    .where(eq(resourceReconcileRuns.id, row.id));
}

async function updateResourceReconcileJson(
  executor: TenantSecretMigrationExecutor,
  row: TenantSecretJsonStorageRow,
): Promise<void> {
  await executor
    .update(resourceReconcileRuns)
    .set({ intentJson: row.json, updatedAt: new Date() })
    .where(eq(resourceReconcileRuns.id, row.id));
}
