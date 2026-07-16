import type { InstallResponse } from '@compartment/contracts';
import { buildLoggedInConfig } from '../../store/config.mutations';
import { readCliConfig, writeCliConfig } from '../../store/config.store';
import type { CliConfig, CliOrganizationConfig } from '../../store/config.types';
import type { DevInstallResult } from '../../install.types';

const defaultDevInstallRemoteName: string = 'local-dev';

export async function persistDevInstallSession(result: DevInstallResult, remoteName?: string): Promise<void> {
  const currentConfig: CliConfig = await readCliConfig();
  await writeCliConfig(
    buildLoggedInConfig(
      currentConfig,
      remoteName ?? defaultDevInstallRemoteName,
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
