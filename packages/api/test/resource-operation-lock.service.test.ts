import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { withResourceOperationLocks } from '../src/services/resource-operation-lock.service';

const acquireResourceOperationLocks: Mock = vi.hoisted((): Mock => vi.fn());

vi.mock('../src/queries/resource-operation-lock.query', (): object => ({
  acquireResourceOperationLocks,
}));

describe('resource operation lock service', (): void => {
  beforeEach((): void => {
    vi.clearAllMocks();
  });

  it('preserves the workflow failure when releasing its serialization lock also fails', async (): Promise<void> => {
    const workflowFailure: Error = new Error('backup failed');
    acquireResourceOperationLocks.mockResolvedValue(failingLock());

    await expect(
      withResourceOperationLocks(['res_postgres'], async (): Promise<void> => {
        await Promise.resolve();
        throw workflowFailure;
      }),
    ).rejects.toBe(workflowFailure);
  });

  it('does not turn a completed durable workflow into a reported failure when unlock cleanup fails', async (): Promise<void> => {
    acquireResourceOperationLocks.mockResolvedValue(failingLock());

    await expect(
      withResourceOperationLocks(['res_postgres'], async (): Promise<string> => await Promise.resolve('completed')),
    ).resolves.toBe('completed');
  });

  it('acquires a multi-resource lock set on one database session', async (): Promise<void> => {
    acquireResourceOperationLocks.mockResolvedValue(successfulLock());

    await withResourceOperationLocks(['res_z', 'res_a'], async (): Promise<void> => await Promise.resolve());

    expect(acquireResourceOperationLocks).toHaveBeenCalledWith(['res_z', 'res_a']);
  });
});

function failingLock(): { release(): Promise<void> } {
  return {
    async release(): Promise<void> {
      await Promise.resolve();
      throw new Error('unlock failed');
    },
  };
}

function successfulLock(): { release(): Promise<void> } {
  return {
    async release(): Promise<void> {
      await Promise.resolve();
    },
  };
}
