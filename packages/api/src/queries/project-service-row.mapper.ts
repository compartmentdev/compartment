import { compartmentServiceKindSchema } from '@compartment/contracts';
import type { PersistedProjectServiceRow, ProjectServiceRow } from './deployments.query.types';

export function toProjectServiceRow(row: PersistedProjectServiceRow): ProjectServiceRow {
  return {
    ...row,
    kind: compartmentServiceKindSchema.parse(row.kind),
  };
}
