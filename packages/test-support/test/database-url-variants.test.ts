import { afterEach, describe, expect, it } from 'vitest';
import {
  deriveTestDatabaseUrl,
  deriveTestDatabaseUrlForRun,
  readTestDatabaseRunId,
  testDatabaseRunIdEnvironmentVariableName,
} from '../src/database-url-variants';

const baseDatabaseUrl: string = 'postgresql://postgres:postgres@127.0.0.1:5432/compartment_test';
const originalRunId: string | undefined = process.env.COMPARTMENT_TEST_DATABASE_RUN_ID;

afterEach((): void => {
  if (originalRunId === undefined) {
    delete process.env[testDatabaseRunIdEnvironmentVariableName];
    return;
  }
  process.env[testDatabaseRunIdEnvironmentVariableName] = originalRunId;
});

describe('deriveTestDatabaseUrl', (): void => {
  it('derives a stable database name from the runner-provided run id and scope', (): void => {
    process.env[testDatabaseRunIdEnvironmentVariableName] = '111111111111';

    const firstUrl: string = deriveTestDatabaseUrl(baseDatabaseUrl, 'api integration');
    const secondUrl: string = deriveTestDatabaseUrl(baseDatabaseUrl, 'api integration');

    expect(firstUrl).toBe(secondUrl);
    expect(readDatabaseName(firstUrl)).toMatch(
      /^compartment_tes_[a-f0-9]{8}__c111111111111_api_integratio_[a-f0-9]{8}$/u,
    );
  });

  it('keeps long database names bounded and collision-resistant', (): void => {
    const longBaseDatabaseUrl: string = baseDatabaseUrl.replace(
      '/compartment_test',
      '/compartment_test_database_name_that_is_longer_than_the_namespace_budget',
    );
    const firstUrl: string = deriveTestDatabaseUrlForRun(
      longBaseDatabaseUrl,
      `${'long_scope_'.repeat(10)}first`,
      '222222222222',
    );
    const secondUrl: string = deriveTestDatabaseUrlForRun(
      longBaseDatabaseUrl,
      `${'long_scope_'.repeat(10)}second`,
      '222222222222',
    );

    expect(Buffer.byteLength(readDatabaseName(firstUrl))).toBeLessThanOrEqual(63);
    expect(Buffer.byteLength(readDatabaseName(secondUrl))).toBeLessThanOrEqual(63);
    expect(firstUrl).not.toBe(secondUrl);
  });

  it('fails fast without a test-run context', (): void => {
    delete process.env[testDatabaseRunIdEnvironmentVariableName];

    expect((): string => deriveTestDatabaseUrl(baseDatabaseUrl, 'api')).toThrow(
      `${testDatabaseRunIdEnvironmentVariableName} must be set by the DB test runner.`,
    );
  });
});

describe('readTestDatabaseRunId', (): void => {
  it('recognizes only the owned database-name format', (): void => {
    const ownedDatabaseName: string = readDatabaseName(
      deriveTestDatabaseUrlForRun(baseDatabaseUrl, 'api', '333333333333'),
    );

    expect(readTestDatabaseRunId('compartment_test', ownedDatabaseName)).toBe('333333333333');
    expect(readTestDatabaseRunId('compartment_test', 'compartment_test_api_12345')).toBeNull();
    expect(readTestDatabaseRunId('compartment_test', 'compartment_test__c333333333333_api')).toBeNull();
    expect(readTestDatabaseRunId('compartment_test', 'unrelated__c333333333333_api_14c2529e')).toBeNull();
  });

  it('does not claim a database owned by an overlapping base name', (): void => {
    const overlappingBaseDatabaseUrl: string = baseDatabaseUrl.replace(
      '/compartment_test',
      '/compartment_test__c333333333333',
    );
    const overlappingDatabaseName: string = readDatabaseName(
      deriveTestDatabaseUrlForRun(overlappingBaseDatabaseUrl, 'api', '444444444444'),
    );

    expect(readTestDatabaseRunId('compartment_test', overlappingDatabaseName)).toBeNull();
    expect(readTestDatabaseRunId('compartment_test__c333333333333', overlappingDatabaseName)).toBe('444444444444');
  });
});

function readDatabaseName(databaseUrl: string): string {
  return new URL(databaseUrl).pathname.slice(1);
}
