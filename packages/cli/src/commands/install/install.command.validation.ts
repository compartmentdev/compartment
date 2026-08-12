import { isValidDnsHostname, normalizeDnsHostname } from '@compartment/utils';
import type { InstallCommandOptions } from './install.command.types';

export function assertDevInstallOptions(options: InstallCommandOptions): void {
  const productionOptions: readonly (keyof InstallCommandOptions)[] = [
    'apiUrl',
    'baseDomain',
    'brokerUrl',
    'chart',
    'ingressClass',
    'ingressEndpoint',
    'kubeContext',
    'managedDomain',
    'namespace',
    'releaseName',
    'registryIssuer',
    'storageClass',
    'tlsIssuer',
    'values',
  ];
  const configuredOption: keyof InstallCommandOptions | undefined = productionOptions.find(
    (optionName: keyof InstallCommandOptions): boolean => options[optionName] !== undefined,
  );
  if (configuredOption !== undefined) {
    throw new Error(`--dev cannot be combined with --${toKebabCase(configuredOption)}.`);
  }
}

export function normalizeInstallBaseDomain(value: string): string {
  const normalizedValue: string = normalizeDnsHostname(value);
  if (!isValidDnsHostname(normalizedValue)) {
    throw new Error('--base-domain must be a valid DNS base domain without a port.');
  }
  return normalizedValue;
}

export function assertOperatorTlsIssuerOption(options: InstallCommandOptions): void {
  if (options.tlsIssuer !== undefined && options.baseDomain === undefined) {
    throw new Error(
      '--tls-issuer requires an operator-owned --base-domain. Managed-domain TLS uses the broker issuer.',
    );
  }
}

function toKebabCase(value: string): string {
  return value.replace(/[A-Z]/gu, (character: string): string => `-${character.toLowerCase()}`);
}
