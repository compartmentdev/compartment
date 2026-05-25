import type { OrganizationSummary } from '@compartment/contracts/browser';
import type { JSX } from 'react';
import { OrganizationSelect } from '../../components/organization-select';

export function readBrowserConsoleOrganizationControl(
  organizations: OrganizationSummary[],
  selectedOrganizationSlug: string | null,
  showOrganizationSelector: boolean,
  onChange: (organizationSlug: string) => void,
): JSX.Element | null {
  if (!showOrganizationSelector) {
    return null;
  }

  return <OrganizationSelect onChange={onChange} organizations={organizations} value={selectedOrganizationSlug} />;
}
