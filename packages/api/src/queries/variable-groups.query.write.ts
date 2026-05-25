import { getApiDatabase } from '../runtime/runtime-access';
import type {
  EnvironmentVariableSetBindingRow,
  InsertVariableChangeEventInput,
  OrganizationVariableSetEntryRow,
} from './variables.query.types';
import type {
  CaptureVariableGroupInput,
  CreateVariableGroupBindingInput,
  CreateVariableGroupInput,
  DeleteVariableGroupBindingInput,
  ImportVariableGroupEntriesInput,
  UpsertVariableGroupEntryInput,
  VariableGroupRow,
} from './variable-groups.query.types';
import { insertVariableChangeEventWithExecutor, type VariablesWriteExecutor } from './variables.query.write.helpers';
import {
  createVariableGroupBindingWithExecutor,
  createVariableGroupWithExecutor,
  deleteVariableGroupBindingWithExecutor,
  touchVariableGroupWithExecutor,
  upsertVariableGroupEntryWithExecutor,
} from './variable-groups.query.helpers';

export async function createVariableGroup(input: CreateVariableGroupInput): Promise<VariableGroupRow> {
  return await createVariableGroupWithExecutor(getApiDatabase(), input);
}

export async function upsertVariableGroupEntryWithAudit(
  input: UpsertVariableGroupEntryInput,
  changeEvent: InsertVariableChangeEventInput,
): Promise<OrganizationVariableSetEntryRow> {
  return await getApiDatabase().transaction(
    async (tx: VariablesWriteExecutor): Promise<OrganizationVariableSetEntryRow> => {
      const row: OrganizationVariableSetEntryRow = await upsertVariableGroupEntryWithExecutor(tx, input);
      await touchVariableGroupWithExecutor(tx, input.variableGroupId, input.updatedAt);
      await insertVariableChangeEventWithExecutor(tx, changeEvent);
      return row;
    },
  );
}

export async function importVariableGroupEntriesWithAudit(
  input: ImportVariableGroupEntriesInput,
): Promise<OrganizationVariableSetEntryRow[]> {
  return await getApiDatabase().transaction(
    async (tx: VariablesWriteExecutor): Promise<OrganizationVariableSetEntryRow[]> => {
      const rows: OrganizationVariableSetEntryRow[] = [];

      for (const value of input.values) {
        rows.push(await upsertVariableGroupEntryWithExecutor(tx, value));
      }

      await touchVariableGroupWithExecutor(tx, input.variableGroupId, input.updatedAt);
      await insertVariableChangeEventWithExecutor(tx, input.changeEvent);
      return rows;
    },
  );
}

export async function captureVariableGroupWithAudit(input: CaptureVariableGroupInput): Promise<VariableGroupRow> {
  return await getApiDatabase().transaction(async (tx: VariablesWriteExecutor): Promise<VariableGroupRow> => {
    const group: VariableGroupRow = await createVariableGroupWithExecutor(tx, input.group);

    for (const value of input.values) {
      await upsertVariableGroupEntryWithExecutor(tx, value);
    }

    await insertVariableChangeEventWithExecutor(tx, input.changeEvent);
    return group;
  });
}

export async function createVariableGroupBindingWithAudit(
  input: CreateVariableGroupBindingInput,
  changeEvent: InsertVariableChangeEventInput,
): Promise<EnvironmentVariableSetBindingRow> {
  return await getApiDatabase().transaction(
    async (tx: VariablesWriteExecutor): Promise<EnvironmentVariableSetBindingRow> => {
      const binding: EnvironmentVariableSetBindingRow = await createVariableGroupBindingWithExecutor(tx, input);
      await insertVariableChangeEventWithExecutor(tx, changeEvent);
      return binding;
    },
  );
}

export async function deleteVariableGroupBindingWithAudit(
  input: DeleteVariableGroupBindingInput,
  changeEvent: InsertVariableChangeEventInput,
): Promise<boolean> {
  return await getApiDatabase().transaction(async (tx: VariablesWriteExecutor): Promise<boolean> => {
    const binding: EnvironmentVariableSetBindingRow | undefined = await deleteVariableGroupBindingWithExecutor(
      tx,
      input,
    );
    if (binding === undefined) {
      return false;
    }

    await insertVariableChangeEventWithExecutor(tx, {
      ...changeEvent,
      targetId: binding.id,
    });
    return true;
  });
}
