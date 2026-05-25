import { sql, type AnyColumn, type SQL } from 'drizzle-orm';
import { principals } from '../db/schema';

export function buildPrincipalEmailLookup(email: string, emailColumn: AnyColumn = principals.email): SQL {
  return sql`lower(${emailColumn}) = lower(${email})`;
}
