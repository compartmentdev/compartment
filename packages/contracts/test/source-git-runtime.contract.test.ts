import { describe, expect, it } from 'vitest';
import { workerFailGitSourceResolutionTaskRequestSchema, type WorkerFailGitSourceResolutionTaskRequest } from '../src';

describe('source git resolution runtime contract', (): void => {
  it('requires worker failure retryability classification', (): void => {
    const fail: WorkerFailGitSourceResolutionTaskRequest = workerFailGitSourceResolutionTaskRequestSchema.parse({
      failureReason: 'checkout failed',
      retryable: true,
      taskId: 'srt_123',
    });

    expect(fail.retryable).toBe(true);
    expect((): void => {
      workerFailGitSourceResolutionTaskRequestSchema.parse({
        failureReason: 'checkout failed',
        taskId: 'srt_123',
      });
    }).toThrow();
  });
});
