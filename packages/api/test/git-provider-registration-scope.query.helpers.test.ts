import { describe, expect, it } from 'vitest';
import { readGitProviderRegistrationOrganizationId } from '../src/queries/git-provider-registration-scope.query.helpers';

describe('git provider registration organization scope', (): void => {
  it.each([
    'https://console.example/v1/sources/git/providers/github/organizations/org_123/registrations/gpr_123/webhook',
    'https://console.example/v1/sources/git/providers/gitlab/organizations/org_123/registrations/gpr_123/webhook',
  ])('reads the organization from %s', (webhookUrl: string): void => {
    expect(readGitProviderRegistrationOrganizationId(webhookUrl)).toBe('org_123');
  });
});
