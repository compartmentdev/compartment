import { eq } from 'drizzle-orm';
import { organizations } from '../db/schema';
import { getApiDatabase } from '../runtime/runtime-access';
import type { ApiDatabaseTransaction } from '../db/client.types';
import type {
  OrganizationAuthSettingsRow,
  UpdateOrganizationAuthSettingsInput,
} from './organization-auth-settings.query.types';

const organizationAuthSettingsSelection: {
  localPasswordEnabled: typeof organizations.localPasswordEnabled;
  organizationId: typeof organizations.id;
} = {
  localPasswordEnabled: organizations.localPasswordEnabled,
  organizationId: organizations.id,
};

export async function findOrganizationAuthSettings(
  organizationId: string,
): Promise<OrganizationAuthSettingsRow | undefined> {
  const rows: OrganizationAuthSettingsRow[] = await getApiDatabase()
    .select(organizationAuthSettingsSelection)
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);

  return rows[0];
}

export async function updateOrganizationAuthSettingsWithExecutor(
  transaction: ApiDatabaseTransaction,
  input: UpdateOrganizationAuthSettingsInput,
): Promise<OrganizationAuthSettingsRow> {
  const rows: OrganizationAuthSettingsRow[] = await transaction
    .update(organizations)
    .set({
      localPasswordEnabled: input.localPasswordEnabled,
    })
    .where(eq(organizations.id, input.organizationId))
    .returning(organizationAuthSettingsSelection);

  return requireOrganizationAuthSettingsUpdate(rows[0]);
}

function requireOrganizationAuthSettingsUpdate(
  settings: OrganizationAuthSettingsRow | undefined,
): OrganizationAuthSettingsRow {
  if (settings === undefined) {
    throw new Error('Expected organization auth settings update to return a row.');
  }

  return settings;
}
