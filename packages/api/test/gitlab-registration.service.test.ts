import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createGitLabRegistration } from '../src/services/git-source/gitlab-registration.service';
import { isTrustedGitLabProviderHost } from '../src/services/outbound-http.service';
import { readGitLabUser } from '../src/services/git-source/gitlab-user.adapter';
import { isGitLabAuthenticationFailure } from '../src/services/git-source/gitlab-http.adapter';
import {
  createGitLabProviderRegistration,
  findActiveGitLabProviderRegistration,
  rotateGitLabProviderRegistrationToken,
} from '../src/queries/gitlab-provider-registration.query';
import type { GitProviderRegistrationRow } from '../src/queries/git-provider-registration.query.types';
import type { CreateGitLabRegistrationInput } from '../src/services/git-source/gitlab-registration.service.types';

vi.mock('../src/services/outbound-http.service');
vi.mock('../src/services/git-source/gitlab-user.adapter');
vi.mock('../src/services/git-source/gitlab-http.adapter');
vi.mock('../src/queries/gitlab-provider-registration.query');
vi.mock('../src/runtime/runtime-access', (): object => ({
  getApiConfig: (): object => ({ variablesMasterKey: Buffer.alloc(32) }),
  getApiDatabase: (): object => ({}),
}));
vi.mock('../src/services/public-hosts.service', (): object => ({
  buildRuntimePublicSettings: (): object => ({ compartmentUrl: 'https://compartment.example' }),
}));

describe('GitLab registration service', (): void => {
  beforeEach((): void => {
    vi.clearAllMocks();
    vi.mocked(isTrustedGitLabProviderHost).mockReturnValue(true);
  });

  it('rejects untrusted hosts before sending the token', async (): Promise<void> => {
    vi.mocked(isTrustedGitLabProviderHost).mockReturnValue(false);
    await expect(createGitLabRegistration(buildInput())).rejects.toMatchObject({
      code: 'git_source_registration_failed',
    });
    expect(readGitLabUser).not.toHaveBeenCalled();
  });

  it('maps GitLab authentication failures to token-invalid', async (): Promise<void> => {
    vi.mocked(readGitLabUser).mockRejectedValue(new Error('unauthorized'));
    vi.mocked(isGitLabAuthenticationFailure).mockReturnValue(true);
    await expect(createGitLabRegistration(buildInput())).rejects.toMatchObject({ code: 'gitlab_token_invalid' });
  });

  it('rotates only token ciphertext for an existing registration', async (): Promise<void> => {
    vi.mocked(readGitLabUser).mockResolvedValue({ username: 'alice' });
    const existing: GitProviderRegistrationRow = buildRegistration();
    vi.mocked(findActiveGitLabProviderRegistration).mockResolvedValue(existing);
    vi.mocked(rotateGitLabProviderRegistrationToken).mockResolvedValue(existing);
    await createGitLabRegistration(buildInput());
    expect(rotateGitLabProviderRegistrationToken).toHaveBeenCalledOnce();
    expect(createGitLabProviderRegistration).not.toHaveBeenCalled();
  });

  it('rotates the registration created by a concurrent request', async (): Promise<void> => {
    const raced: GitProviderRegistrationRow = buildRegistration();
    const postgresError: NodeJS.ErrnoException = new Error('duplicate registration');
    postgresError.code = '23505';
    const uniqueError: Error = new Error('query failed', { cause: postgresError });
    vi.mocked(readGitLabUser).mockResolvedValue({ username: 'alice' });
    vi.mocked(findActiveGitLabProviderRegistration).mockResolvedValueOnce(undefined).mockResolvedValueOnce(raced);
    vi.mocked(createGitLabProviderRegistration).mockRejectedValueOnce(uniqueError);
    vi.mocked(rotateGitLabProviderRegistrationToken).mockResolvedValueOnce(raced);

    await expect(createGitLabRegistration(buildInput())).resolves.toMatchObject({ registrationId: raced.id });
    expect(rotateGitLabProviderRegistrationToken).toHaveBeenCalledOnce();
  });
});

function buildInput(): CreateGitLabRegistrationInput {
  return {
    actorPrincipalId: 'prn_1',
    organizationId: 'org_1',
    request: { accessToken: 'token', providerHost: 'gitlab.com' },
  };
}

function buildRegistration(): GitProviderRegistrationRow {
  return {
    accessTokenCiphertext: 'old',
    accessTokenEncryptionKeyId: 'key',
    appId: null,
    appName: null,
    appSlug: null,
    appUrl: null,
    bootstrapStateId: null,
    callbackUrl: 'https://compartment.example',
    createdAt: new Date(),
    createdByPrincipalId: 'prn_1',
    id: 'gpr_1',
    installationAccountLogin: 'alice',
    installationAccountType: 'User',
    installationId: null,
    organizationId: 'org_1',
    pendingExpiresAt: null,
    privateKeyPemCiphertext: null,
    privateKeyPemEncryptionKeyId: null,
    providerHost: 'gitlab.com',
    providerType: 'gitlab',
    repositoryOwner: 'alice',
    status: 'active',
    updatedAt: new Date(),
    webhookSecretCiphertext: 'secret',
    webhookSecretEncryptionKeyId: 'secret-key',
    webhookUrl:
      'https://compartment.example/v1/sources/git/providers/gitlab/organizations/org_1/registrations/gpr_1/webhook',
  };
}
