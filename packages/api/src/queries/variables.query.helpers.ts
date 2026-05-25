import type { VariableSensitivity } from '@compartment/contracts';
import type {
  EnvironmentVariableValueRow,
  OrganizationVariableSetEntryRow,
  PersistedEnvironmentVariableValueRow,
  PersistedOrganizationVariableSetEntryRow,
} from './variables.query.types';

export function mapSensitiveRow(row: PersistedOrganizationVariableSetEntryRow): OrganizationVariableSetEntryRow;
export function mapSensitiveRow(row: PersistedEnvironmentVariableValueRow): EnvironmentVariableValueRow;
export function mapSensitiveRow<
  TRow extends PersistedOrganizationVariableSetEntryRow | PersistedEnvironmentVariableValueRow,
>(row: TRow): Omit<TRow, 'sensitivity'> & { sensitivity: VariableSensitivity } {
  return {
    ...row,
    sensitivity: row.sensitivity,
  };
}
