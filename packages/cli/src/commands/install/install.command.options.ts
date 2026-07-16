import { hasText } from '@compartment/utils';
import type { KubernetesInstallDomainMode } from '../../services/kubernetes-install.service.types';
import type { InstallCommandOptions } from './install.command.types';
import { parseInstallHttpOrigin } from './install.command.url';

const managedDomainBrokerUrlEnvName: string = 'COMPARTMENT_MANAGED_DOMAIN_BROKER_URL';
const defaultManagedDomainBrokerUrl: string = 'https://broker.compartment.run';

export function readInstallManagedDomainBrokerUrl(
  options: InstallCommandOptions,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  if (resolveInstallDomainMode(options) !== 'managed') {
    if (options.brokerUrl !== undefined) {
      throw new Error('--broker-url requires a managed-domain install.');
    }
    return undefined;
  }

  const environmentUrl: string | undefined = hasText(env[managedDomainBrokerUrlEnvName])
    ? env[managedDomainBrokerUrlEnvName]
    : undefined;
  const configuredUrl: string = options.brokerUrl ?? environmentUrl ?? defaultManagedDomainBrokerUrl;
  return normalizeManagedDomainBrokerUrl(configuredUrl);
}

function normalizeManagedDomainBrokerUrl(configuredUrl: string): string {
  return parseInstallHttpOrigin(
    configuredUrl,
    'Managed domain broker URL must be an absolute HTTP(S) origin without credentials, a path, query, or fragment.',
  ).origin;
}

export function resolveInstallDomainMode(options: InstallCommandOptions): KubernetesInstallDomainMode {
  if (options.managedDomain === true && options.baseDomain !== undefined) {
    throw new Error('Choose either --base-domain or --managed-domain for install, not both.');
  }
  return options.baseDomain === undefined ? 'managed' : 'custom';
}
