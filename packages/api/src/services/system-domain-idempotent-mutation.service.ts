import { systemDomainMutationResponseSchema } from '@compartment/contracts';
import { createDomainIdempotencyConflictError } from '../errors/api-business-error';
import { createId } from '../lib/tokens';
import {
  acquireSystemDomainMutationLockWithExecutor,
  findSystemDomainIdempotencyKeyWithExecutor,
  runSystemDomainMutation,
  storeSystemDomainIdempotencyKeyWithExecutor,
} from '../queries/system-domain.query';
import type { SystemDomainIdempotencyKeyRow, SystemDomainTransaction } from '../queries/system-domain.query.types';
import { hashSystemDomainIdempotencyPayload } from './system-domain-idempotency.service';
import type { SystemDomainMutationResult } from './system-domain.service.types';

export async function runIdempotentSystemDomainMutation(
  idempotencyKey: string,
  requestPayload: object,
  mutate: (tx: SystemDomainTransaction) => Promise<SystemDomainMutationResult>,
): Promise<SystemDomainMutationResult> {
  const requestHash: string = hashSystemDomainIdempotencyPayload(requestPayload);

  return await runSystemDomainMutation(async (tx: SystemDomainTransaction): Promise<SystemDomainMutationResult> => {
    await acquireSystemDomainMutationLockWithExecutor(tx);
    const existingKey: SystemDomainIdempotencyKeyRow | undefined = await findSystemDomainIdempotencyKeyWithExecutor(
      tx,
      idempotencyKey,
    );
    const existingResult: SystemDomainMutationResult | null = readIdempotentSystemDomainMutationResult(
      existingKey,
      requestHash,
    );
    if (existingResult !== null) {
      return existingResult;
    }

    return await runFreshSystemDomainMutation(tx, idempotencyKey, requestHash, mutate);
  });
}

async function runFreshSystemDomainMutation(
  tx: SystemDomainTransaction,
  idempotencyKey: string,
  requestHash: string,
  mutate: (tx: SystemDomainTransaction) => Promise<SystemDomainMutationResult>,
): Promise<SystemDomainMutationResult> {
  const result: SystemDomainMutationResult = await mutate(tx);
  await storeSystemDomainIdempotencyKeyWithExecutor(tx, {
    id: createId('domidem'),
    idempotencyKey,
    requestHash,
    responseJson: JSON.stringify(result),
  });
  return result;
}

function readIdempotentSystemDomainMutationResult(
  existingKey: SystemDomainIdempotencyKeyRow | undefined,
  requestHash: string,
): SystemDomainMutationResult | null {
  if (existingKey === undefined) {
    return null;
  }
  if (existingKey.requestHash !== requestHash) {
    throw createDomainIdempotencyConflictError();
  }

  return systemDomainMutationResponseSchema.parse(JSON.parse(existingKey.responseJson));
}
