export function deriveProcessScopedDatabaseUrl(baseDatabaseUrl: string, scope: string): string {
  return deriveDatabaseUrl(baseDatabaseUrl, `${scope}_${process.pid.toString()}`);
}

export function deriveDatabaseUrl(baseDatabaseUrl: string, suffix: string): string {
  const url: URL = new URL(baseDatabaseUrl);
  const databaseName: string = url.pathname.replace(/^\//, '');
  const nextDatabaseName: string = `${databaseName}_${sanitizeDatabaseNamePart(suffix)}`;

  url.pathname = `/${nextDatabaseName}`;

  return url.toString();
}

function sanitizeDatabaseNamePart(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_]/g, '_');
}
