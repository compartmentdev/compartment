import { eq } from 'drizzle-orm';
import { organizations } from '../db/schema';
import { getApiDatabase } from '../runtime/runtime-access';
import type {
  OrganizationAuditRetentionSettingsMode,
  OrganizationRollbackRetentionSettingsMode,
  OrganizationSettingsRow,
  UpdateOrganizationSettingsInput,
} from './organization-settings.query.types';

const organizationSettingsSelection: {
  auditRetentionDays: typeof organizations.auditRetentionDays;
  auditRetentionMode: typeof organizations.auditRetentionMode;
  organizationId: typeof organizations.id;
  rollbackRetentionLimit: typeof organizations.rollbackRetentionLimit;
  rollbackRetentionMode: typeof organizations.rollbackRetentionMode;
} = {
  auditRetentionDays: organizations.auditRetentionDays,
  auditRetentionMode: organizations.auditRetentionMode,
  organizationId: organizations.id,
  rollbackRetentionLimit: organizations.rollbackRetentionLimit,
  rollbackRetentionMode: organizations.rollbackRetentionMode,
};

interface OrganizationSettingsQueryRow {
  auditRetentionDays: number | null;
  auditRetentionMode: string;
  organizationId: string;
  rollbackRetentionLimit: number | null;
  rollbackRetentionMode: string;
}

export async function findOrganizationSettings(organizationId: string): Promise<OrganizationSettingsRow | undefined> {
  const rows: OrganizationSettingsRow[] = await getApiDatabase()
    .select(organizationSettingsSelection)
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1)
    .then(toOrganizationSettingsRows);

  return rows[0];
}

export async function updateOrganizationSettings(
  input: UpdateOrganizationSettingsInput,
): Promise<OrganizationSettingsRow> {
  const rows: OrganizationSettingsRow[] = await getApiDatabase()
    .update(organizations)
    .set({
      auditRetentionDays: input.auditRetentionDays,
      auditRetentionMode: input.auditRetentionMode,
      rollbackRetentionLimit: input.rollbackRetentionLimit,
      rollbackRetentionMode: input.rollbackRetentionMode,
    })
    .where(eq(organizations.id, input.organizationId))
    .returning(organizationSettingsSelection)
    .then(toOrganizationSettingsRows);

  return requireOrganizationSettings(rows[0]);
}

function toOrganizationSettingsRows(settingsRows: OrganizationSettingsQueryRow[]): OrganizationSettingsRow[] {
  return settingsRows.map(toOrganizationSettingsRow);
}

function requireOrganizationSettings(settings: OrganizationSettingsRow | undefined): OrganizationSettingsRow {
  if (settings === undefined) {
    throw new Error('Expected organization settings update to return a row.');
  }

  return settings;
}

function toOrganizationSettingsRow(row: OrganizationSettingsQueryRow): OrganizationSettingsRow {
  return {
    auditRetentionDays: row.auditRetentionDays,
    auditRetentionMode: row.auditRetentionMode as OrganizationAuditRetentionSettingsMode,
    organizationId: row.organizationId,
    rollbackRetentionLimit: row.rollbackRetentionLimit,
    rollbackRetentionMode: row.rollbackRetentionMode as OrganizationRollbackRetentionSettingsMode,
  };
}
