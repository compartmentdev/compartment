import { describe, expect, it } from 'vitest';
import { parseOptionalPositiveInt } from '../src/config-parsers';

describe('config parsers', (): void => {
  it.each([undefined, '', '  '])(
    'treats %s as an indefinite optional positive integer',
    (value: string | undefined): void => {
      expect(parseOptionalPositiveInt(value, 'ROLLBACK_RETENTION_LIMIT')).toBeNull();
    },
  );

  it.each(['0', '-1', 'x'])('rejects invalid optional positive integer %s', (value: string): void => {
    expect((): number | null => parseOptionalPositiveInt(value, 'ROLLBACK_RETENTION_LIMIT')).toThrow(
      'ROLLBACK_RETENTION_LIMIT must be empty or a positive integer.',
    );
  });
});
