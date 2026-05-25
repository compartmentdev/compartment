import { describe, expect, it } from 'vitest';
import { buildSsoOidcProvisioningPolicy } from '../src/commands/sso/sso-oidc-provisioning.command';

describe('buildSsoOidcProvisioningPolicy', (): void => {
  it('builds enabled auto-join provisioning with trimmed domains', (): void => {
    expect(
      buildSsoOidcProvisioningPolicy({
        autoJoin: 'enabled',
        autoJoinDomains: ' example.com,example.org ,,',
        autoJoinRole: 'viewer',
      }),
    ).toEqual({
      allowedEmailDomains: ['example.com', 'example.org'],
      autoJoinEnabled: true,
      defaultRole: 'viewer',
    });
  });
});
