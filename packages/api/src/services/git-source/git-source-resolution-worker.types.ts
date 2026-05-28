import type { OrganizationRow } from '../../queries/organizations.query.types';
import type { SourceBindingRow, SourceRow } from '../../queries/source.query.types';

export interface DeployableSourceResolutionTaskState {
  binding: SourceBindingRow;
  organization: OrganizationRow;
  source: SourceRow;
}
