import { hasText, isValidDnsHostname, normalizeDnsHostname } from '@compartment/utils';
import type { InstallCommandOptions, ResolvedKubernetesInstallCommandOptions } from './install.command.types';

const defaultKubernetesNamespace: string = 'compartment';
const defaultKubernetesReleaseName: string = 'compartment';

export function assertDevInstallOptions(options: InstallCommandOptions): void {
  const productionOptions: readonly (keyof InstallCommandOptions)[] = [
    'apiUrl',
    'baseDomain',
    'chart',
    'kubeContext',
    'namespace',
    'releaseName',
    'values',
  ];
  const configuredOption: keyof InstallCommandOptions | undefined = productionOptions.find(
    (optionName: keyof InstallCommandOptions): boolean => options[optionName] !== undefined,
  );
  if (configuredOption !== undefined) {
    throw new Error(`--dev cannot be combined with --${toKebabCase(configuredOption)}.`);
  }
}

export function resolveKubernetesInstallCommandOptions(
  options: InstallCommandOptions,
): ResolvedKubernetesInstallCommandOptions {
  const baseDomain: string = normalizeBaseDomain(readRequiredOption(options.baseDomain, '--base-domain'));
  const apiUrl: string = normalizeControlPlaneUrl(readRequiredOption(options.apiUrl, '--api-url'), baseDomain);

  return {
    apiUrl,
    baseDomain,
    ...(options.chart === undefined ? {} : { chartPath: options.chart }),
    ...(options.kubeContext === undefined ? {} : { kubeContext: options.kubeContext }),
    namespace: options.namespace ?? defaultKubernetesNamespace,
    releaseName: options.releaseName ?? defaultKubernetesReleaseName,
    valuesPath: readRequiredOption(options.values, '--values'),
  };
}

function readRequiredOption(value: string | undefined, optionName: string): string {
  if (!hasText(value)) {
    throw new Error(`${optionName} is required for a Kubernetes install.`);
  }
  return value;
}

function normalizeBaseDomain(value: string): string {
  const normalizedValue: string = normalizeDnsHostname(value);
  if (!isValidDnsHostname(normalizedValue)) {
    throw new Error('--base-domain must be a valid DNS base domain without a port.');
  }
  return normalizedValue;
}

function normalizeControlPlaneUrl(value: string, baseDomain: string): string {
  const parsedUrl: URL = new URL(value);
  if (
    (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') ||
    parsedUrl.username !== '' ||
    parsedUrl.password !== '' ||
    (parsedUrl.pathname !== '' && parsedUrl.pathname !== '/') ||
    parsedUrl.search !== '' ||
    parsedUrl.hash !== ''
  ) {
    throw new Error('--api-url must be an HTTP(S) origin without credentials, a path, query, or fragment.');
  }
  if (parsedUrl.protocol === 'http:' && !isReservedLocalhostDomain(baseDomain)) {
    throw new Error('--api-url must use HTTPS outside the reserved .localhost development domain.');
  }
  const expectedHostname: string = `console.${baseDomain}`;
  if (parsedUrl.hostname !== expectedHostname) {
    throw new Error(`--api-url must use the control-plane host ${expectedHostname}.`);
  }
  return parsedUrl.origin;
}

function isReservedLocalhostDomain(baseDomain: string): boolean {
  return baseDomain === 'localhost' || baseDomain.endsWith('.localhost');
}

function toKebabCase(value: string): string {
  return value.replace(/[A-Z]/gu, (character: string): string => `-${character.toLowerCase()}`);
}
