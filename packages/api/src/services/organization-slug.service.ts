import { isOrganizationSlug } from '@compartment/contracts';
import { hasText, slugifyText } from '@compartment/utils';
import { createInvalidOrganizationSlugError } from '../errors/api-business-error';

export function resolveOrganizationSlug(name: string, configuredSlug?: string): string {
  if (configuredSlug !== undefined) {
    if (isOrganizationSlug(configuredSlug)) {
      return configuredSlug;
    }

    throw createInvalidOrganizationSlugError();
  }

  const derivedSlug: string = slugifyText(name);
  if (hasText(derivedSlug)) {
    return derivedSlug;
  }

  throw createInvalidOrganizationSlugError();
}
