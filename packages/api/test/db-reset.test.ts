import { describe, expect, it } from 'vitest';
import { assertSafeResetTarget, parsePostgresConnection, type PostgresConnection } from '../src/db/reset-target';

describe('db:reset', (): void => {
  it('allows localhost dev databases', (): void => {
    const connection: PostgresConnection = parsePostgresConnection(
      'postgresql://postgres:postgres@127.0.0.1:5432/compartment_dev',
    );

    expect((): void => {
      assertSafeResetTarget(connection);
    }).not.toThrow();
  });

  it('allows unix socket test databases', (): void => {
    const connection: PostgresConnection = parsePostgresConnection('postgresql:///compartment_test?host=/tmp');

    expect((): void => {
      assertSafeResetTarget(connection);
    }).not.toThrow();
  });

  it('rejects remote hosts', (): void => {
    const connection: PostgresConnection = parsePostgresConnection(
      'postgresql://postgres:postgres@db.example.com:5432/compartment_dev',
    );

    expect((): void => {
      assertSafeResetTarget(connection);
    }).toThrow(/localhost or Unix socket paths/u);
  });

  it('rejects non-dev database names', (): void => {
    const connection: PostgresConnection = parsePostgresConnection(
      'postgresql://postgres:postgres@127.0.0.1:5432/compartment',
    );

    expect((): void => {
      assertSafeResetTarget(connection);
    }).toThrow(/dev\/test\/local database names/u);
  });

  it('rejects protected maintenance databases', (): void => {
    const connection: PostgresConnection = parsePostgresConnection(
      'postgresql://postgres:postgres@127.0.0.1:5432/postgres',
    );

    expect((): void => {
      assertSafeResetTarget(connection);
    }).toThrow(/dev\/test\/local database names/u);
  });
});
