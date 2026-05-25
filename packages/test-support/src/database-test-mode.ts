interface DatabaseTestMode {
  testDatabaseUrl: string;
}

const TEST_DATABASE_URL_ENV_NAME: string = 'COMPARTMENT_TEST_DATABASE_URL';

export function readDatabaseTestMode(env: NodeJS.ProcessEnv = process.env): DatabaseTestMode {
  const explicitTestDatabaseUrl: string | undefined = env.COMPARTMENT_TEST_DATABASE_URL;
  if (!hasTrimmedText(explicitTestDatabaseUrl)) {
    throw new Error(`${TEST_DATABASE_URL_ENV_NAME} must be set to run DB-backed tests.`);
  }

  return {
    testDatabaseUrl: explicitTestDatabaseUrl,
  };
}

function hasTrimmedText(value: string | undefined): value is string {
  return value !== undefined && value.trim() !== '';
}
