import { describe, expect, it } from 'vitest';
import {
  isRetryableGitSourceTaskError,
  WorkerGitProviderHttpError,
} from '../src/services/worker-git-source-resolution-failure.support';

describe('git-source provider retry policy', (): void => {
  it.each([
    [401, false],
    [403, false],
    [404, false],
    [429, true],
    [500, true],
    [503, true],
  ])('classifies stubbed provider HTTP %i as retryable=%s', (status: number, retryable: boolean): void => {
    expect(isRetryableGitSourceTaskError(new WorkerGitProviderHttpError('stubbed provider response', status))).toBe(
      retryable,
    );
  });
});
