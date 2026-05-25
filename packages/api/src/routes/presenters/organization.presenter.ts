import type { OrganizationSummary } from '@compartment/contracts';
import type { OrganizationSummaryInput } from '../../services/presenter.types';

function buildOrganizationSummary(row: OrganizationSummaryInput): OrganizationSummary {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
  };
}

export function buildOrganizationSummaries(rows: OrganizationSummaryInput[]): OrganizationSummary[] {
  return rows.map(buildOrganizationSummary);
}
