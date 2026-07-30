const managedDomainBrokerUrlEnvName: string = 'COMPARTMENT_MANAGED_DOMAIN_BROKER_URL';
const defaultManagedDomainBrokerUrl: string = 'https://broker.compartment.run';

export function resolveInstallManagedDomainBrokerUrl(
  brokerUrl: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const configuredBrokerUrl: string = brokerUrl ?? env[managedDomainBrokerUrlEnvName] ?? defaultManagedDomainBrokerUrl;
  try {
    const resolvedBrokerUrl: URL = new URL(configuredBrokerUrl);
    if (
      (resolvedBrokerUrl.protocol !== 'http:' && resolvedBrokerUrl.protocol !== 'https:') ||
      resolvedBrokerUrl.username !== '' ||
      resolvedBrokerUrl.password !== ''
    ) {
      throw new Error('Unsupported managed-domain broker URL protocol.');
    }
    return resolvedBrokerUrl.toString().replace(/\/$/u, '');
  } catch {
    throw new Error(
      'Managed domain broker URL must be a valid absolute HTTP(S) URL. Set --broker-url or COMPARTMENT_MANAGED_DOMAIN_BROKER_URL.',
    );
  }
}
