import { eq } from 'drizzle-orm';
import type { Database } from '../db/client';
import { localCredentials, principals } from '../db/schema';
import { buildPrincipalEmailLookup } from './principal-email.query.helpers';
import type { LoginRow } from './login.query.types';

export async function findLoginRowByEmailWithExecutor(
  executor: LoginQueryExecutor,
  email: string,
): Promise<LoginRow | undefined> {
  const loginRows: LoginRow[] = await executor
    .select({
      passwordHash: localCredentials.passwordHash,
      principalEmail: principals.email,
      principalId: principals.id,
      principalType: principals.type,
    })
    .from(principals)
    .innerJoin(localCredentials, eq(localCredentials.principalId, principals.id))
    .where(buildPrincipalEmailLookup(email));

  return loginRows[0];
}

type LoginQueryExecutor = Pick<Database, 'select'>;
