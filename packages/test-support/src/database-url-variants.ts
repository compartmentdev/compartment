import { createHash } from 'node:crypto';
import { readDatabaseName, replaceDatabaseName } from './database-url';

const postgresIdentifierMaximumLength: number = 63;
const testDatabaseBaseSegmentMaximumLength: number = 24;
const testDatabaseHashLength: number = 8;
const testDatabaseRunIdPattern: RegExp = /^[a-f0-9]{12}$/u;
const testDatabaseRunMarker: string = '__c';
export const testDatabaseRunIdEnvironmentVariableName: string = 'COMPARTMENT_TEST_DATABASE_RUN_ID';

export function deriveTestDatabaseUrl(baseDatabaseUrl: string, scope: string): string {
  const runId: string | undefined = process.env.COMPARTMENT_TEST_DATABASE_RUN_ID;
  if (runId === undefined || runId === '') {
    throw new Error(`${testDatabaseRunIdEnvironmentVariableName} must be set by the DB test runner.`);
  }

  return deriveTestDatabaseUrlForRun(baseDatabaseUrl, scope, runId);
}

export function deriveTestDatabaseUrlForRun(baseDatabaseUrl: string, scope: string, runId: string): string {
  assertTestDatabaseRunId(runId);
  const baseDatabaseName: string = readDatabaseName(baseDatabaseUrl);
  const prefix: string = createTestDatabaseRunPrefix(baseDatabaseName, runId);
  const scopeHash: string = createShortHash(scope);
  const scopeMaximumLength: number = postgresIdentifierMaximumLength - prefix.length - scopeHash.length - 1;
  const scopeSegment: string = sanitizeDatabaseNamePart(scope).slice(0, scopeMaximumLength);
  const databaseName: string = `${prefix}${scopeSegment}_${scopeHash}`;

  return replaceDatabaseName(baseDatabaseUrl, databaseName);
}

export function createTestDatabaseRunPrefix(baseDatabaseName: string, runId: string): string {
  assertTestDatabaseRunId(runId);
  return `${createBaseDatabaseSegment(baseDatabaseName)}${testDatabaseRunMarker}${runId}_`;
}

export function readTestDatabaseRunId(baseDatabaseName: string, databaseName: string): string | null {
  const prefix: string = `${createBaseDatabaseSegment(baseDatabaseName)}${testDatabaseRunMarker}`;
  if (!databaseName.startsWith(prefix)) {
    return null;
  }

  const runIdStart: number = prefix.length;
  const runId: string = databaseName.slice(runIdStart, runIdStart + 12);
  const scopeAndHash: string = databaseName.slice(runIdStart + 13);
  if (
    databaseName[runIdStart + 12] !== '_' ||
    !testDatabaseRunIdPattern.test(runId) ||
    !/^[a-z0-9_]+_[a-f0-9]{8}$/u.test(scopeAndHash)
  ) {
    return null;
  }

  return runId;
}

function createBaseDatabaseSegment(baseDatabaseName: string): string {
  if (baseDatabaseName.length <= testDatabaseBaseSegmentMaximumLength) {
    return baseDatabaseName;
  }

  const hash: string = createShortHash(baseDatabaseName);
  const prefixLength: number = testDatabaseBaseSegmentMaximumLength - hash.length - 1;
  return `${baseDatabaseName.slice(0, prefixLength)}_${hash}`;
}

function sanitizeDatabaseNamePart(value: string): string {
  const sanitizedValue: string = value.toLowerCase().replace(/[^a-z0-9_]/gu, '_');
  return sanitizedValue === '' ? 'scope' : sanitizedValue;
}

function createShortHash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, testDatabaseHashLength);
}

function assertTestDatabaseRunId(runId: string): void {
  if (!testDatabaseRunIdPattern.test(runId)) {
    throw new Error(`Invalid test database run id: ${runId}`);
  }
}
