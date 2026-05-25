import type { EnvironmentRow } from './deployments.query.types';
import type { OrganizationRow } from './organizations.query.types';
import type { ProjectRow } from './projects.query.types';
import type { ProjectResourceRow } from './resources.query.types';

export interface ScheduledResourceOperationCandidateRow {
  environment: EnvironmentRow;
  organization: OrganizationRow;
  project: ProjectRow;
  resource: ProjectResourceRow;
}
