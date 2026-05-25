import { describe, expect, it } from 'vitest';
import { buildWorkerCaughtErrorLogPayload } from '../src/logging/worker-error-log';

describe('buildWorkerCaughtErrorLogPayload', (): void => {
  it('maps Error instances to the pino err field', (): void => {
    const error: Error = new Error('node deploy failed');

    expect(buildWorkerCaughtErrorLogPayload(error)).toEqual({
      err: error,
    });
  });

  it('falls back to a string message for non-Error throwables', (): void => {
    expect(buildWorkerCaughtErrorLogPayload('boom')).toEqual({
      errorMessage: 'boom',
    });
  });
});
