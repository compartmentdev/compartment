import {
  legacyVariableEncryptionKeyId,
  rewrapVariableValueForStorage,
  tenantVariableEncryptionKeyId,
} from '../lib/variables-crypto';
import {
  listTenantSecretJsonStorageRows,
  listTenantSecretStorageRows,
  claimTenantSecretMigrationMarker,
  updateTenantSecretJsonStorageRow,
  updateTenantSecretStorageRow,
} from '../queries/tenant-secret-migration.query';
import type {
  TenantSecretMigrationExecutor,
  TenantSecretJsonStorageRow,
  TenantSecretStorageRow,
  TenantSecretStorageUpdate,
} from '../queries/tenant-secret-migration.query.types';
import type {
  TenantSecretMigrationKeys,
  MigratedTenantSecretJson,
  TenantSecretMigrationResult,
} from './tenant-secret-migration.service.types';
import { migrateJsonStorageRow } from './tenant-secret-migration-json.service';

const migrationMarkerPrefix: string = 'tenant-secret-envelope:';

export async function migrateTenantSecretEnvelopes(
  executor: TenantSecretMigrationExecutor,
  keys: TenantSecretMigrationKeys,
): Promise<TenantSecretMigrationResult> {
  const currentKeyId: string = tenantVariableEncryptionKeyId(keys.currentKek);
  const markerId: string = `${migrationMarkerPrefix}${currentKeyId}`;
  if (!(await claimTenantSecretMigrationMarker(executor, markerId))) {
    return { migrated: false, rewrappedCount: 0 };
  }
  const canonicalCount: number = await migrateCanonicalRows(executor, keys, currentKeyId);
  const jsonCount: number = await migrateJsonRows(executor, keys);
  const rewrappedCount: number = canonicalCount + jsonCount;
  return { migrated: rewrappedCount > 0, rewrappedCount };
}

async function migrateCanonicalRows(
  executor: TenantSecretMigrationExecutor,
  keys: TenantSecretMigrationKeys,
  currentKeyId: string,
): Promise<number> {
  const rows: TenantSecretStorageRow[] = await listTenantSecretStorageRows(executor);
  let rewrappedCount: number = 0;
  for (const row of rows) {
    if (row.encryptionKeyId === currentKeyId) {
      continue;
    }
    await updateTenantSecretStorageRow(executor, rewrapTenantSecretStorageRow(row, keys));
    rewrappedCount += 1;
  }
  return rewrappedCount;
}

async function migrateJsonRows(
  executor: TenantSecretMigrationExecutor,
  keys: TenantSecretMigrationKeys,
): Promise<number> {
  const jsonRows: TenantSecretJsonStorageRow[] = await listTenantSecretJsonStorageRows(executor);
  let rewrappedCount: number = 0;
  for (const row of jsonRows) {
    const migrated: MigratedTenantSecretJson = migrateJsonStorageRow(row, keys);
    if (migrated.rewrappedCount === 0) {
      continue;
    }
    await updateTenantSecretJsonStorageRow(executor, { ...row, json: migrated.json });
    rewrappedCount += migrated.rewrappedCount;
  }
  return rewrappedCount;
}

function rewrapTenantSecretStorageRow(
  row: TenantSecretStorageRow,
  keys: TenantSecretMigrationKeys,
): TenantSecretStorageUpdate {
  const sourceKek: Buffer | undefined = findSourceKek(row.encryptionKeyId, keys);
  if (sourceKek === undefined) {
    throw new Error(`Tenant secret row ${row.storage}/${row.id} uses an unavailable KEK.`);
  }
  return {
    ...row,
    ...rewrapVariableValueForStorage(row.valueCiphertext, row.encryptionKeyId, sourceKek, keys.currentKek),
  };
}

function findSourceKek(encryptionKeyId: string, keys: TenantSecretMigrationKeys): Buffer | undefined {
  return keys.sourceKeks.find(
    (key: Buffer): boolean =>
      encryptionKeyId === tenantVariableEncryptionKeyId(key) || encryptionKeyId === legacyVariableEncryptionKeyId(key),
  );
}
