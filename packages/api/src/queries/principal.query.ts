import { eq } from 'drizzle-orm';
import { principals } from '../db/schema';
import { getApiDatabase } from '../runtime/runtime-access';
import { buildPrincipalEmailLookup } from './principal-email.query.helpers';

interface PrincipalEmailSelection {
  email: string;
}

interface PrincipalIdSelection {
  id: string;
}

export async function findPrincipalEmailById(principalId: string): Promise<string | undefined> {
  const rows: PrincipalEmailSelection[] = await getApiDatabase()
    .select({ email: principals.email })
    .from(principals)
    .where(eq(principals.id, principalId))
    .limit(1);

  return rows[0]?.email;
}

export async function findPrincipalIdByEmail(email: string): Promise<string | undefined> {
  const rows: PrincipalIdSelection[] = await getApiDatabase()
    .select({ id: principals.id })
    .from(principals)
    .where(buildPrincipalEmailLookup(email))
    .limit(1);

  return rows[0]?.id;
}
