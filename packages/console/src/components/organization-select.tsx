import type { ChangeEvent, JSX } from 'react';
import type { BrowserOrganizationOption } from '../services/browser-organization.service.types';
import { Select } from './select';

interface OrganizationSelectProps {
  onChange: (organizationSlug: string) => void;
  organizations: BrowserOrganizationOption[];
  value: string | null;
}

export function OrganizationSelect({ onChange, organizations, value }: Readonly<OrganizationSelectProps>): JSX.Element {
  return (
    <label className="flex items-center gap-2">
      <span className="sr-only">Organization</span>
      <Select
        aria-label="Organization"
        className="min-w-[11rem]"
        onChange={(event: ChangeEvent<HTMLSelectElement>): void => {
          if (event.target.value !== '') {
            onChange(event.target.value);
          }
        }}
        value={value ?? ''}
      >
        {renderOrganizationOptions(organizations, value)}
      </Select>
    </label>
  );
}

function renderOrganizationOptions(organizations: BrowserOrganizationOption[], value: string | null): JSX.Element[] {
  const options: JSX.Element[] = organizations.map(
    (organization: BrowserOrganizationOption): JSX.Element => (
      <option key={organization.slug} value={organization.slug}>
        {organization.name}
      </option>
    ),
  );
  return value === null
    ? [
        <option disabled key="placeholder" value="">
          Choose organization
        </option>,
        ...options,
      ]
    : options;
}
