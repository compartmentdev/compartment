import { describe, expect, it } from 'vitest';
import { parseResolvedRun } from '../src/services/deployment-run.service';

describe('deployment run service', (): void => {
  it('rejects stored snapshots without a restart policy', (): void => {
    expect((): void => {
      parseResolvedRun('{}');
    }).toThrow();
    expect((): void => {
      parseResolvedRun(JSON.stringify({ command: 'pnpm start' }));
    }).toThrow();
  });

  it('preserves explicit stored restart policies', (): void => {
    expect(
      parseResolvedRun(
        JSON.stringify({
          restart: {
            maxRetries: 5,
            policy: 'on-failure',
          },
        }),
      ),
    ).toEqual({
      restart: {
        maxRetries: 5,
        policy: 'on-failure',
      },
    });
  });
});
