import { managedDomainRequestedLabelSourceMaxLength } from '@compartment/contracts';
import { hasText, slugifyText } from '@compartment/utils';

export function readManagedDomainRequestedLabelSource(
  organizationName: string,
  organizationSlug: string | undefined,
): string {
  const requestedLabelSource: string = (organizationSlug ?? organizationName).slice(
    0,
    managedDomainRequestedLabelSourceMaxLength,
  );
  if (!hasText(slugifyText(requestedLabelSource))) {
    throw new Error('Organization slug must contain at least one letter or digit.');
  }
  return requestedLabelSource;
}
