import { afterEach, describe, expect, it } from 'vitest';
import type { ApiConfig } from '../../src/config';
import type { Database } from '../../src/db/client';
import { clearApiRuntime, configureApiRuntime } from '../../src/runtime/runtime';
import { buildCreateProviderInput } from '../../src/services/sso-oidc/sso-oidc-provider-config.service';
import type { CreateSsoOidcProviderInput } from '../../src/services/sso-oidc/sso-oidc.service.types';
import { createSsoOidcApiConfig } from './sso-oidc-login.service.fixtures';

describe('SSO OIDC provider config', (): void => {
  afterEach((): void => {
    clearApiRuntime();
  });

  it('rejects issuer URLs with credentials before saving provider config', (): void => {
    configureRuntime();

    expect((): void => {
      buildCreateProviderInput({
        ...createCreateProviderInput(),
        issuerUrl: 'https://admin:secret@idp.example.com',
      });
    }).toThrow('Issuer URL must not include credentials.');
  });
});

function configureRuntime(): void {
  const config: ApiConfig = {
    ...createSsoOidcApiConfig(),
    trustedOutboundHosts: ['idp.example.com'],
  };
  configureApiRuntime({
    config,
    db: {} as Database,
  });
}

function createCreateProviderInput(): CreateSsoOidcProviderInput {
  return {
    actorPrincipalId: 'usr_admin',
    clientId: 'client-id',
    clientSecret: 'client-secret',
    displayName: 'Example IDP',
    issuerUrl: 'https://idp.example.com',
    key: 'example-idp',
    organizationId: 'org_123',
    organizationSlug: 'acme',
    preset: 'generic',
  };
}
