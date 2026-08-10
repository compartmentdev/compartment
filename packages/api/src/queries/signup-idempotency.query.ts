import { eq } from 'drizzle-orm';
import { principals, signupIdempotencyKeys } from '../db/schema';
import { getApiDatabase } from '../runtime/runtime-access';
import type {
  SignupIdempotencyRecordRow,
  SignupIdempotencyTransaction,
  StoreSignupIdempotencyKeyInput,
} from './signup-idempotency.query.types';

export async function findSignupIdempotencyRecord(keyHash: string): Promise<SignupIdempotencyRecordRow | undefined> {
  const rows: SignupIdempotencyRecordRow[] = await getApiDatabase()
    .select({
      createdAt: signupIdempotencyKeys.createdAt,
      principalEmail: principals.email,
      principalId: signupIdempotencyKeys.principalId,
      requestHash: signupIdempotencyKeys.requestHash,
    })
    .from(signupIdempotencyKeys)
    .innerJoin(principals, eq(principals.id, signupIdempotencyKeys.principalId))
    .where(eq(signupIdempotencyKeys.keyHash, keyHash))
    .limit(1);

  return rows[0];
}

export async function storeSignupIdempotencyKeyWithExecutor(
  tx: SignupIdempotencyTransaction,
  input: StoreSignupIdempotencyKeyInput,
): Promise<void> {
  await tx.insert(signupIdempotencyKeys).values(input);
}
