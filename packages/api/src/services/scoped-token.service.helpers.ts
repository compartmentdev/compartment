import { hasText } from '@compartment/utils';
import { createToken } from '../lib/tokens';
import type { ScopedTokenScope } from './scoped-token.service.types';

const organizationScopedTokenPrefix: string = 'org';
const scopedTokenSeparator: string = '.';

export function createOrganizationScopedToken(organizationId: string): string {
  return createScopedToken({ kind: 'organization', organizationId });
}

export function readScopedTokenScope(token: string): ScopedTokenScope {
  const parts: string[] = token.split(scopedTokenSeparator);
  const organizationId: string | undefined = parts[1];
  const scopedToken: string | undefined = parts[2];
  if (
    parts.length === 3 &&
    parts[0] === organizationScopedTokenPrefix &&
    hasText(organizationId) &&
    hasText(scopedToken)
  ) {
    return {
      kind: 'organization',
      organizationId,
    };
  }

  return {
    kind: 'system',
  };
}

function createScopedToken(tokenScope: ScopedTokenScope | undefined): string {
  const token: string = createToken();
  if (tokenScope === undefined || tokenScope.kind === 'system') {
    return token;
  }

  return [organizationScopedTokenPrefix, tokenScope.organizationId, token].join(scopedTokenSeparator);
}
