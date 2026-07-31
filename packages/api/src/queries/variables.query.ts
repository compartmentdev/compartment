import { and, asc, eq, inArray, isNull, type SQL } from 'drizzle-orm';
import {
  environments,
  environmentVariableSetBindings,
  environmentVariableValues,
  organizationVariableSetEntries,
  organizationVariableSets,
  projects,
  projectServices,
  variableAccessEvents,
} from '../db/schema';
import { getApiDatabase } from '../runtime/runtime-access';
import type {
  EnvironmentVariableImportAuditResult,
  EnvironmentVariableSetBindingRow,
  EnvironmentVariableSetBindingSelection,
  EnvironmentVariableValueRow,
  EnvironmentVariableWriteAuditResult,
  ImportEnvironmentVariableValuesInput,
  InsertVariableAccessEventInput,
  InsertVariableChangeEventInput,
  OrganizationVariableSetEntrySelection,
  OrganizationVariableSetEntryRow,
  OrganizationVariableSetNameRow,
  PersistedEnvironmentVariableValueRow,
  PersistedOrganizationVariableSetEntryRow,
  PersistedOrganizationVariableSetRow,
  PersistedProjectServiceRow,
  ProjectServiceNameRow,
  UpsertEnvironmentVariableValueInput,
  VariableAccessEventRow,
} from './variables.query.types';
import { insertVariableAuditEventsWithExecutor } from './variables-audit.query';
import { mapSensitiveRow } from './variables.query.helpers';
import {
  insertVariableChangeEventWithExecutor,
  upsertEnvironmentVariableValueWithExecutor,
  type VariablesWriteExecutor,
} from './variables.query.write.helpers';

const organizationVariableSetEntrySelection: OrganizationVariableSetEntrySelection = {
  createdAt: organizationVariableSetEntries.createdAt,
  createdByPrincipalId: organizationVariableSetEntries.createdByPrincipalId,
  encryptionKeyId: organizationVariableSetEntries.encryptionKeyId,
  id: organizationVariableSetEntries.id,
  keyName: organizationVariableSetEntries.keyName,
  organizationVariableSetId: organizationVariableSetEntries.organizationVariableSetId,
  sensitivity: organizationVariableSetEntries.sensitivity,
  updatedAt: organizationVariableSetEntries.updatedAt,
  updatedByPrincipalId: organizationVariableSetEntries.updatedByPrincipalId,
  valueCiphertext: organizationVariableSetEntries.valueCiphertext,
  valueFingerprint: organizationVariableSetEntries.valueFingerprint,
};

const environmentVariableSetBindingSelection: EnvironmentVariableSetBindingSelection = {
  createdAt: environmentVariableSetBindings.createdAt,
  createdByPrincipalId: environmentVariableSetBindings.createdByPrincipalId,
  environmentId: environmentVariableSetBindings.environmentId,
  id: environmentVariableSetBindings.id,
  organizationVariableSetId: environmentVariableSetBindings.organizationVariableSetId,
  projectServiceId: environmentVariableSetBindings.projectServiceId,
  targetResourceName: environmentVariableSetBindings.targetResourceName,
};

export async function listOrganizationVariableSetEntriesForSetIds(
  organizationVariableSetIds: string[],
  organizationId: string,
): Promise<OrganizationVariableSetEntryRow[]> {
  if (organizationVariableSetIds.length === 0) {
    return [];
  }

  const rows: PersistedOrganizationVariableSetEntryRow[] = await getApiDatabase()
    .select(organizationVariableSetEntrySelection)
    .from(organizationVariableSetEntries)
    .innerJoin(
      organizationVariableSets,
      eq(organizationVariableSets.id, organizationVariableSetEntries.organizationVariableSetId),
    )
    .where(buildActiveVariableSetIdsPredicate(organizationVariableSetIds, organizationId))
    .orderBy(
      asc(organizationVariableSetEntries.organizationVariableSetId),
      asc(organizationVariableSetEntries.keyName),
    );

  return rows.map(
    (row: PersistedOrganizationVariableSetEntryRow): OrganizationVariableSetEntryRow => mapSensitiveRow(row),
  );
}

export async function listOrganizationVariableSetNamesByIds(
  organizationVariableSetIds: string[],
  organizationId: string,
): Promise<OrganizationVariableSetNameRow[]> {
  if (organizationVariableSetIds.length === 0) {
    return [];
  }

  const rows: PersistedOrganizationVariableSetRow[] = await getApiDatabase()
    .select()
    .from(organizationVariableSets)
    .where(
      and(
        inArray(organizationVariableSets.id, organizationVariableSetIds),
        eq(organizationVariableSets.organizationId, organizationId),
        isNull(organizationVariableSets.archivedAt),
      ),
    )
    .orderBy(asc(organizationVariableSets.name));

  return rows.map(
    (row: PersistedOrganizationVariableSetRow): OrganizationVariableSetNameRow => ({
      id: row.id,
      name: row.name,
    }),
  );
}

export async function listEnvironmentVariableValues(environmentId: string): Promise<EnvironmentVariableValueRow[]> {
  const rows: PersistedEnvironmentVariableValueRow[] = await getApiDatabase()
    .select()
    .from(environmentVariableValues)
    .where(eq(environmentVariableValues.environmentId, environmentId))
    .orderBy(asc(environmentVariableValues.keyName));

  return rows.map((row: PersistedEnvironmentVariableValueRow): EnvironmentVariableValueRow => mapSensitiveRow(row));
}

export async function listEnvironmentVariableSetBindings(
  environmentId: string,
  organizationId: string,
): Promise<EnvironmentVariableSetBindingRow[]> {
  const rows: EnvironmentVariableSetBindingRow[] = await getApiDatabase()
    .select(environmentVariableSetBindingSelection)
    .from(environmentVariableSetBindings)
    .innerJoin(
      organizationVariableSets,
      eq(organizationVariableSets.id, environmentVariableSetBindings.organizationVariableSetId),
    )
    .innerJoin(environments, eq(environments.id, environmentVariableSetBindings.environmentId))
    .innerJoin(projects, eq(projects.id, environments.projectId))
    .where(buildActiveEnvironmentVariableSetBindingsPredicate(environmentId, organizationId))
    .orderBy(asc(environmentVariableSetBindings.organizationVariableSetId));

  return rows;
}

export async function listProjectServiceNamesByProjectId(projectId: string): Promise<ProjectServiceNameRow[]> {
  const rows: PersistedProjectServiceRow[] = await getApiDatabase()
    .select()
    .from(projectServices)
    .where(eq(projectServices.projectId, projectId))
    .orderBy(asc(projectServices.name));

  return rows.map(
    (row: PersistedProjectServiceRow): ProjectServiceNameRow => ({
      id: row.id,
      name: row.name,
    }),
  );
}

export async function upsertEnvironmentVariableValueWithAudit(
  input: UpsertEnvironmentVariableValueInput,
  changeEvent: InsertVariableChangeEventInput,
): Promise<EnvironmentVariableWriteAuditResult> {
  return await getApiDatabase().transaction(
    async (tx: VariablesWriteExecutor): Promise<EnvironmentVariableWriteAuditResult> => {
      const row: EnvironmentVariableValueRow = await upsertEnvironmentVariableValueWithExecutor(tx, input);
      await insertVariableChangeEventWithExecutor(tx, changeEvent);
      return {
        auditEvents: await insertVariableAuditEventsWithExecutor(
          tx,
          changeEvent.actorPrincipalId,
          changeEvent.auditEvents ?? [],
        ),
        value: row,
      };
    },
  );
}

export async function importEnvironmentVariableValues(
  input: ImportEnvironmentVariableValuesInput,
): Promise<EnvironmentVariableImportAuditResult> {
  return await getApiDatabase().transaction(
    async (tx: VariablesWriteExecutor): Promise<EnvironmentVariableImportAuditResult> => {
      const rows: EnvironmentVariableValueRow[] = [];

      for (const value of input.values) {
        rows.push(await upsertEnvironmentVariableValueWithExecutor(tx, value));
      }

      await insertVariableChangeEventWithExecutor(tx, input.changeEvent);
      return {
        auditEvents: await insertVariableAuditEventsWithExecutor(
          tx,
          input.changeEvent.actorPrincipalId,
          input.changeEvent.auditEvents ?? [],
        ),
        values: rows,
      };
    },
  );
}

export async function insertVariableAccessEvent(
  input: InsertVariableAccessEventInput,
): Promise<VariableAccessEventRow> {
  const rows: VariableAccessEventRow[] = await getApiDatabase().insert(variableAccessEvents).values(input).returning();
  const row: VariableAccessEventRow | undefined = rows[0];
  if (row === undefined) {
    throw new Error('Failed to persist variable access event.');
  }

  return row;
}

export { deleteEnvironmentVariableValueWithAudit } from './variables-delete.query';

function buildActiveVariableSetIdsPredicate(organizationVariableSetIds: string[], organizationId: string): SQL {
  return and(
    inArray(organizationVariableSetEntries.organizationVariableSetId, organizationVariableSetIds),
    eq(organizationVariableSets.organizationId, organizationId),
    isNull(organizationVariableSets.archivedAt),
  )!;
}

function buildActiveEnvironmentVariableSetBindingsPredicate(environmentId: string, organizationId: string): SQL {
  return and(
    eq(environmentVariableSetBindings.environmentId, environmentId),
    eq(organizationVariableSets.organizationId, organizationId),
    eq(projects.organizationId, organizationId),
    isNull(organizationVariableSets.archivedAt),
  )!;
}
