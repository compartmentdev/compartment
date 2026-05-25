import { and, eq, isNull, type SQL } from 'drizzle-orm';
import type { Database } from '../db/client';
import {
  environmentVariableSetBindings,
  organizationVariableSetEntries,
  organizationVariableSets,
  projects,
} from '../db/schema';
import { mapSensitiveRow } from './variables.query.helpers';
import type {
  EnvironmentVariableSetBindingRow,
  OrganizationVariableSetEntryRow,
  PersistedOrganizationVariableSetEntryRow,
} from './variables.query.types';
import type {
  CreateVariableGroupBindingInput,
  CreateVariableGroupInput,
  DeleteVariableGroupBindingInput,
  UpsertVariableGroupEntryInput,
  VariableGroupRow,
} from './variable-groups.query.types';
import type { VariablesWriteExecutor } from './variables.query.write.helpers';

export async function createVariableGroupWithExecutor(
  executor: Pick<Database, 'insert'>,
  input: CreateVariableGroupInput,
): Promise<VariableGroupRow> {
  const rows: VariableGroupRow[] = await executor
    .insert(organizationVariableSets)
    .values({
      createdByPrincipalId: input.createdByPrincipalId,
      description: input.description ?? null,
      id: input.id,
      name: input.name,
      organizationId: input.organizationId,
      updatedAt: input.updatedAt,
    })
    .returning();

  return mapRequiredVariableGroupRow(rows[0]);
}

export async function upsertVariableGroupEntryWithExecutor(
  executor: VariablesWriteExecutor,
  input: UpsertVariableGroupEntryInput,
): Promise<OrganizationVariableSetEntryRow> {
  const existingRow: OrganizationVariableSetEntryRow | undefined = await findVariableGroupEntryWithExecutor(
    executor,
    input.variableGroupId,
    input.keyName,
  );

  return existingRow === undefined
    ? await createVariableGroupEntryWithExecutor(executor, input)
    : await updateVariableGroupEntryWithExecutor(executor, input);
}

export async function createVariableGroupBindingWithExecutor(
  executor: Pick<Database, 'insert'>,
  input: CreateVariableGroupBindingInput,
): Promise<EnvironmentVariableSetBindingRow> {
  const rows: EnvironmentVariableSetBindingRow[] = await executor
    .insert(environmentVariableSetBindings)
    .values(buildVariableGroupBindingValues(input))
    .returning();

  return mapRequiredVariableGroupBindingRow(rows[0]);
}

export async function deleteVariableGroupBindingWithExecutor(
  executor: Pick<Database, 'delete'>,
  input: DeleteVariableGroupBindingInput,
): Promise<EnvironmentVariableSetBindingRow | undefined> {
  const rows: EnvironmentVariableSetBindingRow[] = await executor
    .delete(environmentVariableSetBindings)
    .where(
      buildVariableGroupBindingPredicate(
        input.environmentId,
        input.projectServiceId,
        input.targetResourceName,
        input.variableGroupId,
      ),
    )
    .returning();

  return rows[0];
}

export async function touchVariableGroupWithExecutor(
  executor: Pick<Database, 'update'>,
  variableGroupId: string,
  updatedAt: Date,
): Promise<void> {
  await executor
    .update(organizationVariableSets)
    .set({ updatedAt })
    .where(eq(organizationVariableSets.id, variableGroupId));
}

export function buildActiveVariableGroupPredicate(organizationId: string): SQL {
  return and(eq(organizationVariableSets.organizationId, organizationId), isNull(organizationVariableSets.archivedAt))!;
}

export function buildVariableGroupByNamePredicate(organizationId: string, variableGroupName: string): SQL {
  return and(
    eq(organizationVariableSets.organizationId, organizationId),
    eq(organizationVariableSets.name, variableGroupName),
    isNull(organizationVariableSets.archivedAt),
  )!;
}

export function buildScopedVariableGroupBindingPredicate(organizationId: string, variableGroupId: string): SQL {
  return and(
    eq(environmentVariableSetBindings.organizationVariableSetId, variableGroupId),
    eq(organizationVariableSets.organizationId, organizationId),
    eq(projects.organizationId, organizationId),
    isNull(organizationVariableSets.archivedAt),
  )!;
}

function buildVariableGroupBindingPredicate(
  environmentId: string,
  projectServiceId: string | null,
  targetResourceName: string | null,
  variableGroupId: string,
): SQL {
  return and(
    eq(environmentVariableSetBindings.environmentId, environmentId),
    eq(environmentVariableSetBindings.organizationVariableSetId, variableGroupId),
    projectServiceId === null
      ? isNull(environmentVariableSetBindings.projectServiceId)
      : eq(environmentVariableSetBindings.projectServiceId, projectServiceId),
    targetResourceName === null
      ? isNull(environmentVariableSetBindings.targetResourceName)
      : eq(environmentVariableSetBindings.targetResourceName, targetResourceName),
  )!;
}

async function createVariableGroupEntryWithExecutor(
  executor: Pick<Database, 'insert'>,
  input: UpsertVariableGroupEntryInput,
): Promise<OrganizationVariableSetEntryRow> {
  const rows: PersistedOrganizationVariableSetEntryRow[] = await executor
    .insert(organizationVariableSetEntries)
    .values({
      createdByPrincipalId: input.createdByPrincipalId,
      encryptionKeyId: input.encryptionKeyId,
      id: input.id,
      keyName: input.keyName,
      organizationVariableSetId: input.variableGroupId,
      sensitivity: input.sensitivity,
      updatedAt: input.updatedAt,
      updatedByPrincipalId: input.updatedByPrincipalId,
      valueCiphertext: input.valueCiphertext,
      valueFingerprint: input.valueFingerprint,
    })
    .returning();

  return mapRequiredVariableGroupEntryRow(rows[0]);
}

async function updateVariableGroupEntryWithExecutor(
  executor: VariablesWriteExecutor,
  input: UpsertVariableGroupEntryInput,
): Promise<OrganizationVariableSetEntryRow> {
  const rows: PersistedOrganizationVariableSetEntryRow[] = await executor
    .update(organizationVariableSetEntries)
    .set({
      encryptionKeyId: input.encryptionKeyId,
      sensitivity: input.sensitivity,
      updatedAt: input.updatedAt,
      updatedByPrincipalId: input.updatedByPrincipalId,
      valueCiphertext: input.valueCiphertext,
      valueFingerprint: input.valueFingerprint,
    })
    .where(buildVariableGroupEntryPredicate(input.variableGroupId, input.keyName))
    .returning();

  return mapRequiredVariableGroupEntryRow(rows[0]);
}

async function findVariableGroupEntryWithExecutor(
  executor: Pick<Database, 'select'>,
  variableGroupId: string,
  keyName: string,
): Promise<OrganizationVariableSetEntryRow | undefined> {
  const rows: PersistedOrganizationVariableSetEntryRow[] = await executor
    .select()
    .from(organizationVariableSetEntries)
    .where(buildVariableGroupEntryPredicate(variableGroupId, keyName))
    .limit(1);

  return rows[0] !== undefined ? mapSensitiveRow(rows[0]) : undefined;
}

function buildVariableGroupEntryPredicate(variableGroupId: string, keyName: string): SQL {
  return and(
    eq(organizationVariableSetEntries.organizationVariableSetId, variableGroupId),
    eq(organizationVariableSetEntries.keyName, keyName),
  )!;
}

function mapRequiredVariableGroupRow(row: VariableGroupRow | undefined): VariableGroupRow {
  if (row === undefined) {
    throw new Error('Failed to persist variable group.');
  }

  return row;
}

function mapRequiredVariableGroupEntryRow(
  row: PersistedOrganizationVariableSetEntryRow | undefined,
): OrganizationVariableSetEntryRow {
  if (row === undefined) {
    throw new Error('Failed to persist variable group entry.');
  }

  return mapSensitiveRow(row);
}

function mapRequiredVariableGroupBindingRow(
  row: EnvironmentVariableSetBindingRow | undefined,
): EnvironmentVariableSetBindingRow {
  if (row === undefined) {
    throw new Error('Failed to persist variable group binding.');
  }

  return row;
}

function buildVariableGroupBindingValues(input: CreateVariableGroupBindingInput): {
  createdByPrincipalId: string;
  environmentId: string;
  id: string;
  organizationVariableSetId: string;
  projectServiceId: string | null;
  targetResourceName: string | null;
} {
  return {
    createdByPrincipalId: input.createdByPrincipalId,
    environmentId: input.environmentId,
    id: input.id,
    organizationVariableSetId: input.variableGroupId,
    projectServiceId: input.projectServiceId,
    targetResourceName: input.targetResourceName,
  };
}
