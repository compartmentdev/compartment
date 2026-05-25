import type { InstallResponse } from '@compartment/contracts';
import { buildLoggedInConfig } from '../../store/config.mutations';
import { readCliConfig, writeCliConfig } from '../../store/config.store';
import type { CliConfig, CliOrganizationConfig } from '../../store/config.types';
import type { SelfHostedInstallResult } from '../../install.types';

const defaultDevInstallRemoteName: string = 'local-dev';
const defaultInstallRemoteName: string = 'default';

export async function persistDevInstallSession(result: SelfHostedInstallResult, remoteName?: string): Promise<void> {
  await persistInstallSession(result, remoteName ?? defaultDevInstallRemoteName);
}

export async function persistInstallSession(
  result: SelfHostedInstallResult,
  remoteName: string = defaultInstallRemoteName,
): Promise<void> {
  const currentConfig: CliConfig = await readCliConfig();
  await writeCliConfig(
    buildLoggedInConfig(
      currentConfig,
      remoteName,
      result.apiUrl,
      result.adminEmail,
      result.sessionToken,
      toStoredOrganization(result),
    ),
  );
}

function toStoredOrganization(result: InstallResponse): CliOrganizationConfig {
  return {
    id: result.organization.id,
    name: result.organization.name,
    slug: result.organization.slug,
  };
}
