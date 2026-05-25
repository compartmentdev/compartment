import { readSelfHostedEnvironmentValues, readRequiredSelfHostedEnvironmentValue } from './self-hosted-env-file';
import { readCanonicalSystemApiSocketPath } from './self-hosted-host-socket-paths';
import { buildSelfHostedPathSelection } from './self-hosted-install-paths';
import type { SelfHostedPathSelection } from './self-hosted-install-paths.types';
import { readRequiredSelfHostedInstall } from './self-hosted-install-read';
import type { ReadSelfHostedInstallResult } from './self-hosted-install-read.types';
import { assertSelfHostedSystemPrivileges } from './self-hosted-system-privileges';
import type { SystemApiClientConfig } from './system-api-client.types';

export interface SystemCommandContext {
  client: SystemApiClientConfig;
}

export async function createSystemCommandContext(): Promise<SystemCommandContext> {
  const environmentValues: Record<string, string> = await readSystemEnvironmentValues();

  return {
    client: readSystemClientConfig(environmentValues),
  };
}

export async function readSystemEnvironmentValues(): Promise<Record<string, string>> {
  const paths: SelfHostedPathSelection = buildSelfHostedPathSelection();
  assertSelfHostedSystemPrivileges();
  const install: ReadSelfHostedInstallResult = await readRequiredSelfHostedInstall(paths);
  return readSelfHostedEnvironmentValues(install.environmentText);
}

export function readSystemClientConfig(environmentValues: Record<string, string>): SystemApiClientConfig {
  return {
    socketPath: readCanonicalSystemApiSocketPath(environmentValues),
    token: readRequiredSelfHostedEnvironmentValue(environmentValues, 'COMPARTMENT_SYSTEM_TOKEN'),
  };
}
