import { acquireResourceOperationLocks } from '../queries/resource-operation-lock.query';
import type { ResourceOperationLock } from '../queries/resource-operation-lock.query.types';

export async function withResourceOperationLocks<Result>(
  resourceIds: string[],
  operation: () => Promise<Result>,
): Promise<Result> {
  if (resourceIds.length === 0) {
    return await operation();
  }
  const lock: ResourceOperationLock = await acquireResourceOperationLocks(resourceIds);
  try {
    return await operation();
  } finally {
    await releaseResourceOperationLock(lock, resourceIds);
  }
}

async function releaseResourceOperationLock(lock: ResourceOperationLock, resourceIds: string[]): Promise<void> {
  try {
    await lock.release();
  } catch (error) {
    const message: string = error instanceof Error ? error.message : String(error);
    process.emitWarning(`Failed to release resource operation lock for ${resourceIds.join(', ')}: ${message}`, {
      code: 'COMPARTMENT_RESOURCE_OPERATION_LOCK_RELEASE_FAILED',
    });
  }
}
