import { hasText } from '@compartment/utils';

const safeDatabaseNamePattern: RegExp = /^[a-zA-Z0-9_]+$/u;

export function readDatabaseName(databaseUrl: string): string {
  const url: URL = new URL(databaseUrl);
  const databaseName: string = url.pathname.replace(/^\//u, '');
  if (!hasText(databaseName)) {
    throw new Error(`Database name is missing in ${databaseUrl}`);
  }
  assertSafeDatabaseName(databaseName);
  return databaseName;
}

export function createMaintenanceDatabaseUrl(databaseUrl: string): string {
  return replaceDatabaseName(databaseUrl, 'postgres');
}

export function replaceDatabaseName(databaseUrl: string, databaseName: string): string {
  assertSafeDatabaseName(databaseName);
  const url: URL = new URL(databaseUrl);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

export function assertSafeDatabaseName(databaseName: string): void {
  if (!safeDatabaseNamePattern.test(databaseName)) {
    throw new Error(`Unsafe database name: ${databaseName}`);
  }
}
