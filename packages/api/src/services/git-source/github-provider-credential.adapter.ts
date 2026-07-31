import { decryptVariableValueFromStorage } from '../../lib/variables-crypto';
import { findGitHubAppRegistrationCredential } from '../../queries/github-app-registration-credential.query';
import type {
  GitHubAppRegistrationCredentialRow,
  GitProviderReadExecutor,
} from '../../queries/git-provider-registration.query.types';
import { getApiConfig } from '../../runtime/runtime-access';
import type { GitProviderCredential } from './git-source-provider.types';
import { requireGitProviderField } from './git-source-view.service';

export async function readGitHubAppProviderCredential(
  executor: GitProviderReadExecutor,
  registrationId: string,
): Promise<GitProviderCredential> {
  const credential: GitHubAppRegistrationCredentialRow | undefined = await findGitHubAppRegistrationCredential(
    executor,
    registrationId,
  );
  if (credential === undefined) {
    throw new Error('GitHub App registration credential is missing.');
  }
  return buildGitHubAppProviderCredential(credential);
}

function buildGitHubAppProviderCredential(
  credential: GitHubAppRegistrationCredentialRow,
): Extract<GitProviderCredential, { kind: 'github_app' }> {
  return {
    appId: requireGitProviderField(credential.appId, 'app_id'),
    appName: requireGitProviderField(credential.appName, 'app_name'),
    appSlug: requireGitProviderField(credential.appSlug, 'app_slug'),
    appUrl: requireGitProviderField(credential.appUrl, 'app_url'),
    installationAccountLogin: requireGitProviderField(
      credential.installationAccountLogin,
      'installation_account_login',
    ),
    installationAccountType: requireGitProviderField(credential.installationAccountType, 'installation_account_type'),
    installationId: requireGitProviderField(credential.installationId, 'installation_id'),
    kind: 'github_app',
    privateKeyPem: decryptVariableValueFromStorage(
      requireGitProviderField(credential.privateKeyPemCiphertext, 'private_key_pem_ciphertext'),
      requireGitProviderField(credential.privateKeyPemEncryptionKeyId, 'private_key_pem_encryption_key_id'),
      getApiConfig().variablesMasterKey,
    ),
  };
}
