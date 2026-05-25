import { hasText } from '@compartment/utils';

export interface PostgresConnection {
  database: string;
  host: string;
  password: string;
  port: string;
  user: string;
}

const localDatabaseHostnames: ReadonlySet<string> = new Set(['', '127.0.0.1', '::1', '[::1]', 'localhost']);
const localDatabaseNamePattern: RegExp = /(^|_)(dev|test|local)($|_)/u;
const protectedDatabaseNames: ReadonlySet<string> = new Set(['postgres', 'template0', 'template1']);

export function parsePostgresConnection(connectionString: string): PostgresConnection {
  const parsed: URL = new URL(connectionString);
  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    throw new Error('COMPARTMENT_DATABASE_URL must use postgres:// or postgresql://.');
  }

  const database: string = parsed.pathname.replace(/^\//u, '');
  if (!hasText(database)) {
    throw new Error('COMPARTMENT_DATABASE_URL must include a database name.');
  }

  return {
    database,
    host: parsed.searchParams.get('host') ?? parsed.hostname,
    password: decodeURIComponent(parsed.password),
    port: parsed.port,
    user: decodeURIComponent(parsed.username),
  };
}

export function assertSafeResetTarget(connection: PostgresConnection): void {
  if (!isLocalDatabaseHost(connection.host)) {
    throw new Error(
      `Refusing to reset ${describeResetTarget(connection)}. ` +
        'db:reset only supports databases on localhost or Unix socket paths.',
    );
  }

  if (!isSafeLocalDatabaseName(connection.database)) {
    throw new Error(
      `Refusing to reset ${describeResetTarget(connection)}. ` +
        'db:reset only supports local dev/test/local database names.',
    );
  }
}

function describeResetTarget(connection: PostgresConnection): string {
  const hostLabel: string = connection.host === '' ? 'default local host' : connection.host;
  return `database "${connection.database}" on ${hostLabel}`;
}

function isLocalDatabaseHost(host: string): boolean {
  if (host.startsWith('/')) {
    return true;
  }

  return localDatabaseHostnames.has(host.toLowerCase());
}

function isSafeLocalDatabaseName(databaseName: string): boolean {
  return !protectedDatabaseNames.has(databaseName) && localDatabaseNamePattern.test(databaseName);
}
