import { describe, expect, it } from 'vitest';
import { parseResolvedRun } from '../src/services/deployment-run.service';

describe('deployment run service', (): void => {
  it('accepts stored snapshots with only the Kubernetes runtime command', (): void => {
    expect(parseResolvedRun('{}')).toEqual({});
    expect(parseResolvedRun(JSON.stringify({ command: 'pnpm start' }))).toEqual({ command: 'pnpm start' });
  });

  it('rejects the removed host-runtime restart descriptor', (): void => {
    expect((): void => {
      parseResolvedRun(JSON.stringify({ restart: { maxRetries: 5, policy: 'on-failure' } }));
    }).toThrow("Unrecognized key(s) in object: 'restart'");
  });
});
