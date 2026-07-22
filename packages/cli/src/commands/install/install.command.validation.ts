import { isOrganizationSlug } from '@compartment/contracts';
import { hasText, isValidDnsHostname, normalizeDnsHostname } from '@compartment/utils';
import { isReservedKubernetesInstallLocalhostDomain } from '../../kubernetes-install-domain';
import { readInstallManagedDomainBrokerUrl, resolveInstallDomainMode } from './install.command.options';
import type { InstallCommandOptions, ResolvedKubernetesInstallCommandOptions } from './install.command.types';
import { parseInstallHttpOrigin } from './install.command.url';
import type { KubernetesInstallDomainMode } from '../../services/kubernetes-install.service.types';

const defaultKubernetesNamespace: string = 'compartment';
const defaultKubernetesReleaseName: string = 'compartment';

export function assertDevInstallOptions(options: InstallCommandOptions): void {
  const productionOptions: readonly (keyof InstallCommandOptions)[] = [
    'apiUrl',
    'baseDomain',
    'brokerUrl',
    'chart',
    'kubeContext',
    'managedDomain',
    'namespace',
    'releaseName',
    'skipRegistryMirror',
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
  const baseDomain: string | undefined =
    options.baseDomain === undefined ? undefined : normalizeBaseDomain(options.baseDomain);
  assertInstallOrganizationSlug(options.organizationSlug);
  const domainMode: KubernetesInstallDomainMode = resolveInstallDomainMode(options);
  const brokerUrl: string | undefined = readInstallManagedDomainBrokerUrl(options);
  const apiUrl: string | undefined =
    options.apiUrl === undefined ? undefined : normalizeControlPlaneUrl(options.apiUrl);
  if (apiUrl !== undefined && baseDomain !== undefined) {
    assertControlPlaneUrlHostname(apiUrl, baseDomain);
  }

  return {
    ...(apiUrl === undefined ? {} : { apiUrl }),
    ...(baseDomain === undefined ? {} : { baseDomain }),
    ...(brokerUrl === undefined ? {} : { brokerUrl }),
    ...(options.chart === undefined ? {} : { chartPath: options.chart }),
    domainMode,
    ...(options.kubeContext === undefined ? {} : { kubeContext: options.kubeContext }),
    namespace: options.namespace ?? defaultKubernetesNamespace,
    releaseName: options.releaseName ?? defaultKubernetesReleaseName,
    valuesPath: readRequiredOption(options.values, '--values'),
  };
}

function assertInstallOrganizationSlug(organizationSlug: string | undefined): void {
  if (organizationSlug === undefined) {
    return;
  }
  if (!isOrganizationSlug(organizationSlug)) {
    throw new Error('Organization slug must use lowercase letters, digits, and single hyphens.');
  }
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

function normalizeControlPlaneUrl(value: string): string {
  const parsedUrl: URL = parseInstallHttpOrigin(
    value,
    '--api-url must be an HTTP(S) origin without credentials, a path, query, or fragment.',
  );
  if (parsedUrl.protocol === 'http:' && !isReservedKubernetesInstallLocalhostDomain(parsedUrl.hostname)) {
    throw new Error('--api-url must use HTTPS outside the reserved .localhost development domain.');
  }
  return parsedUrl.origin;
}

function assertControlPlaneUrlHostname(apiUrl: string, baseDomain: string): void {
  const expectedHostname: string = `console.${baseDomain}`;
  if (new URL(apiUrl).hostname !== expectedHostname) {
    throw new Error(`--api-url must use the control-plane host ${expectedHostname}.`);
  }
}

function toKebabCase(value: string): string {
  return value.replace(/[A-Z]/gu, (character: string): string => `-${character.toLowerCase()}`);
}
