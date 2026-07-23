import { hasText } from '@compartment/utils';
import { execa } from 'execa';
import { readRequiredDatabaseUrl } from './database-url';
import { runMigrations } from './migrate';
import { assertSafeResetTarget, parsePostgresConnection, type PostgresConnection } from './reset-target';

async function runDatabaseReset(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const connectionString: string = readRequiredDatabaseUrl(env);
  const connection: PostgresConnection = parsePostgresConnection(connectionString);
  assertSafeResetTarget(connection);
  const childEnv: NodeJS.ProcessEnv = buildDatabaseCommandEnv(env, connection);

  console.error(`Resetting database ${connection.database} from COMPARTMENT_DATABASE_URL.`);

  await runCommand('dropdb', buildDropDatabaseArgs(connection), childEnv);
  await runCommand('createdb', buildCreateDatabaseArgs(connection), childEnv);
  await runMigrations(connectionString);
}

if (require.main === module) {
  void runDatabaseReset().catch((error: Error): void => {
    console.error(error.message);
    process.exit(1);
  });
}

function buildDatabaseCommandEnv(env: NodeJS.ProcessEnv, connection: PostgresConnection): NodeJS.ProcessEnv {
  return {
    ...env,
    ...(hasText(connection.password) ? { PGPASSWORD: connection.password } : {}),
  };
}

function buildDropDatabaseArgs(connection: PostgresConnection): string[] {
  return ['--if-exists', '--force', ...buildConnectionArgs(connection), connection.database];
}

function buildCreateDatabaseArgs(connection: PostgresConnection): string[] {
  return [...buildConnectionArgs(connection), connection.database];
}

function buildConnectionArgs(connection: PostgresConnection): string[] {
  const args: string[] = [];

  if (hasText(connection.host)) {
    args.push('-h', connection.host);
  }

  if (hasText(connection.port)) {
    args.push('-p', connection.port);
  }

  if (hasText(connection.user)) {
    args.push('-U', connection.user);
  }

  return args;
}

async function runCommand(command: string, args: string[], env: NodeJS.ProcessEnv): Promise<void> {
  await execa(command, args, { env, extendEnv: false, stdio: 'inherit' });
}
