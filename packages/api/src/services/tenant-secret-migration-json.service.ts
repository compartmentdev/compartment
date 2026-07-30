import type { JsonValue } from '@compartment/utils';
import {
  type EncryptedVariableValue,
  encryptTenantVariableValueForStorage,
  legacyVariableEncryptionKeyId,
  rewrapVariableValueForStorage,
  tenantVariableEncryptionKeyId,
} from '../lib/variables-crypto';
import type { TenantSecretJsonStorageRow } from '../queries/tenant-secret-migration.query.types';
import type {
  MigratedTenantSecretJson,
  MigratedTenantSecretValue,
  TenantSecretJsonObject,
  TenantSecretMigrationKeys,
} from './tenant-secret-migration.service.types';

export function migrateJsonStorageRow(
  row: TenantSecretJsonStorageRow,
  keys: TenantSecretMigrationKeys,
): MigratedTenantSecretJson {
  const parsed: JsonValue = JSON.parse(row.json) as JsonValue;
  return migrateParsedJsonStorageRow(row, parsed, keys);
}

function migrateParsedJsonStorageRow(
  row: TenantSecretJsonStorageRow,
  parsed: JsonValue,
  keys: TenantSecretMigrationKeys,
): MigratedTenantSecretJson {
  if (row.storage === 'project_resources_env') {
    const migrated: MigratedTenantSecretValue = migrateResourceEnvArray(parsed, keys);
    return { json: JSON.stringify(migrated.value), rewrappedCount: migrated.rewrappedCount };
  }
  if (row.storage === 'project_resources_operations') {
    return migrateResourceOperations(parsed, keys);
  }
  if (row.storage === 'resource_backups') {
    return migrateResourceBackupSnapshot(row, parsed, keys);
  }
  if (row.storage === 'resource_reconcile_rollbacks') {
    return migrateResourceRollback(row, parsed, keys);
  }
  return migrateObjectStorageRow(row, parsed, keys);
}

function migrateObjectStorageRow(
  row: TenantSecretJsonStorageRow,
  parsed: JsonValue,
  keys: TenantSecretMigrationKeys,
): MigratedTenantSecretJson {
  if (!isJsonObject(parsed)) {
    throw new Error(`Tenant secret JSON row ${row.storage}/${row.id} must contain an object.`);
  }
  return row.storage === 'resource_reconcile_runs'
    ? migrateResourceReconcileIntent(row, parsed, keys)
    : migrateJsonEnvironment(parsed, keys);
}

function migrateResourceReconcileIntent(
  row: TenantSecretJsonStorageRow,
  intent: TenantSecretJsonObject,
  keys: TenantSecretMigrationKeys,
): MigratedTenantSecretJson {
  const environment: JsonValue | undefined = intent.env;
  if (environment === undefined) {
    return { json: row.json, rewrappedCount: 0 };
  }
  if (!isJsonObject(environment)) {
    throw new Error(`Tenant secret JSON row ${row.storage}/${row.id} has an invalid env object.`);
  }
  const migrated: MigratedTenantSecretJson = migrateJsonEnvironment(environment, keys);
  return {
    json: JSON.stringify({ ...intent, env: JSON.parse(migrated.json) as JsonValue }),
    rewrappedCount: migrated.rewrappedCount,
  };
}

function migrateResourceRollback(
  row: TenantSecretJsonStorageRow,
  value: JsonValue,
  keys: TenantSecretMigrationKeys,
): MigratedTenantSecretJson {
  if (Array.isArray(value)) {
    return encryptJsonString(row.json, keys);
  }
  const migrated: JsonValue = migrateJsonEnvironmentValue(value, keys);
  return { json: JSON.stringify(migrated), rewrappedCount: JSON.stringify(migrated) === row.json ? 0 : 1 };
}

function encryptJsonString(value: string, keys: TenantSecretMigrationKeys): MigratedTenantSecretJson {
  const encrypted: EncryptedVariableValue = encryptTenantVariableValueForStorage(
    value,
    keys.currentKek,
    keys.currentKek,
  );
  return {
    json: JSON.stringify({
      encryptionKeyId: encrypted.encryptionKeyId,
      valueCiphertext: encrypted.valueCiphertext,
    }),
    rewrappedCount: 1,
  };
}

function migrateResourceBackupSnapshot(
  row: TenantSecretJsonStorageRow,
  value: JsonValue,
  keys: TenantSecretMigrationKeys,
): MigratedTenantSecretJson {
  if (!isJsonObject(value) || typeof value.envJson !== 'string' || typeof value.operationsJson !== 'string') {
    throw new Error(`Tenant secret JSON row ${row.storage}/${row.id} has an invalid resource snapshot.`);
  }
  const env: MigratedTenantSecretValue = migrateResourceEnvArray(JSON.parse(value.envJson) as JsonValue, keys);
  const operations: MigratedTenantSecretJson = migrateResourceOperations(
    JSON.parse(value.operationsJson) as JsonValue,
    keys,
  );
  return {
    json: JSON.stringify({ ...value, envJson: JSON.stringify(env.value), operationsJson: operations.json }),
    rewrappedCount: env.rewrappedCount + operations.rewrappedCount,
  };
}

function migrateResourceOperations(value: JsonValue, keys: TenantSecretMigrationKeys): MigratedTenantSecretJson {
  if (!isJsonObject(value)) {
    throw new Error('Persisted resource operations must contain an object.');
  }
  const backup: MigratedTenantSecretValue = migrateResourceOperation(value.backup, 'backup', keys);
  const restore: MigratedTenantSecretValue = migrateResourceOperation(value.restore, 'restore', keys);
  return {
    json: JSON.stringify({ ...value, backup: backup.value, restore: restore.value }),
    rewrappedCount: backup.rewrappedCount + restore.rewrappedCount,
  };
}

function migrateResourceOperation(
  operation: JsonValue | undefined,
  name: 'backup' | 'restore',
  keys: TenantSecretMigrationKeys,
): MigratedTenantSecretValue {
  if (operation === null || operation === undefined) {
    return { rewrappedCount: 0, value: null };
  }
  if (!isJsonObject(operation)) {
    throw new Error(`Persisted resource ${name} operation must contain an object.`);
  }
  const migratedEnv: MigratedTenantSecretValue = migrateResourceEnvArray(operation.env ?? [], keys);
  return { rewrappedCount: migratedEnv.rewrappedCount, value: { ...operation, env: migratedEnv.value } };
}

function migrateResourceEnvArray(value: JsonValue, keys: TenantSecretMigrationKeys): MigratedTenantSecretValue {
  if (!Array.isArray(value)) {
    throw new Error('Persisted resource environment must contain an array.');
  }
  const migrated: JsonValue[] = value.map((source: JsonValue): JsonValue => migrateResourceEnvSource(source, keys));
  const rewrappedCount: number = migrated.filter(
    (source: JsonValue, index: number): boolean => JSON.stringify(source) !== JSON.stringify(value[index]),
  ).length;
  return { rewrappedCount, value: migrated };
}

function migrateResourceEnvSource(source: JsonValue, keys: TenantSecretMigrationKeys): JsonValue {
  if (!isJsonObject(source)) {
    throw new Error('Persisted resource environment contains an invalid source.');
  }
  const literalValue: JsonValue | undefined = source.literalValue;
  return literalValue === null || literalValue === undefined
    ? source
    : { ...source, literalValue: migrateJsonEnvironmentValue(literalValue, keys) };
}

function migrateJsonEnvironment(
  environment: TenantSecretJsonObject,
  keys: TenantSecretMigrationKeys,
): MigratedTenantSecretJson {
  const migrated: TenantSecretJsonObject = Object.fromEntries(
    Object.entries(environment).map(([name, value]: [string, JsonValue]): [string, JsonValue] => [
      name,
      migrateJsonEnvironmentValue(value, keys),
    ]),
  );
  const rewrappedCount: number = Object.keys(environment).filter(
    (name: string): boolean => JSON.stringify(migrated[name]) !== JSON.stringify(environment[name]),
  ).length;
  return { json: JSON.stringify(migrated), rewrappedCount };
}

function migrateJsonEnvironmentValue(value: JsonValue, keys: TenantSecretMigrationKeys): JsonValue {
  if (typeof value === 'string') {
    const encrypted: EncryptedVariableValue = encryptTenantVariableValueForStorage(
      value,
      keys.currentKek,
      keys.currentKek,
    );
    return {
      encryptionKeyId: encrypted.encryptionKeyId,
      valueCiphertext: encrypted.valueCiphertext,
    };
  }
  assertTenantSecretEnvelope(value);
  if (value.encryptionKeyId === tenantVariableEncryptionKeyId(keys.currentKek)) {
    return value;
  }
  return rewrapTenantSecretValue(value.valueCiphertext, value.encryptionKeyId, keys);
}

function assertTenantSecretEnvelope(
  value: JsonValue,
): asserts value is TenantSecretJsonObject & { encryptionKeyId: string; valueCiphertext: string } {
  if (!isJsonObject(value) || typeof value.encryptionKeyId !== 'string' || typeof value.valueCiphertext !== 'string') {
    throw new Error('Persisted tenant secret environment contains an invalid value.');
  }
}

function rewrapTenantSecretValue(
  valueCiphertext: string,
  encryptionKeyId: string,
  keys: TenantSecretMigrationKeys,
): Pick<EncryptedVariableValue, 'encryptionKeyId' | 'valueCiphertext'> {
  const sourceKek: Buffer | undefined = findSourceKek(encryptionKeyId, keys);
  if (sourceKek === undefined) {
    throw new Error(`Tenant secret JSON value uses unavailable KEK "${encryptionKeyId}".`);
  }
  return rewrapVariableValueForStorage(valueCiphertext, encryptionKeyId, sourceKek, keys.currentKek);
}

function findSourceKek(encryptionKeyId: string, keys: TenantSecretMigrationKeys): Buffer | undefined {
  return keys.sourceKeks.find(
    (key: Buffer): boolean =>
      encryptionKeyId === tenantVariableEncryptionKeyId(key) || encryptionKeyId === legacyVariableEncryptionKeyId(key),
  );
}

function isJsonObject(value: JsonValue): value is TenantSecretJsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
