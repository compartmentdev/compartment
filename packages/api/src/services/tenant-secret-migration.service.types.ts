import type { JsonValue } from '@compartment/utils';

export interface TenantSecretMigrationKeys {
  currentKek: Buffer;
  sourceKeks: Buffer[];
}

export type TenantSecretJsonObject = Record<string, JsonValue>;

export interface MigratedTenantSecretJson {
  json: string;
  rewrappedCount: number;
}

export interface MigratedTenantSecretValue {
  rewrappedCount: number;
  value: JsonValue;
}

export interface TenantSecretMigrationResult {
  migrated: boolean;
  rewrappedCount: number;
}
