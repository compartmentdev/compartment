import { buildPrivateRegistryHost, type DomainIssuerReference } from '@compartment/contracts';
import { isValidDnsHostname } from '@compartment/utils';
import { z } from 'zod';
import { isReservedKubernetesInstallLocalhostDomain } from '../kubernetes-install-domain';
import type { KubernetesInstallDomainMode } from './kubernetes-install.service.types';
import type {
  KubernetesInstallRegistryConfiguration,
  KubernetesInstallRegistryIssuerReference,
  KubernetesInstallRegistryIssuerValueFields,
  KubernetesInstallRegistryValueFields,
} from './kubernetes-install-registry.service.types';
import { formatSchemaValidationError } from './schema-validation-error';
import { readYamlFile, type YamlFileValue } from './yaml-file';
import { kubernetesInstallRegistryIssuerValueFieldsSchema } from './kubernetes-install-registry-values.schema';
import {
  kubernetesInstallTlsValueFieldsSchema,
  type KubernetesInstallTlsValueFields,
} from './kubernetes-install-tls-values.schema';

interface KubernetesInstallRegistrySourceValues {
  registry?: KubernetesInstallRegistryValueFields | undefined;
  tls?: KubernetesInstallTlsValueFields | undefined;
}

interface ResolveKubernetesInstallRegistryInput {
  baseDomain?: string | undefined;
  domainMode: KubernetesInstallDomainMode;
  valuesPath: string;
}

const defaultPlatformIssuer: KubernetesInstallRegistryIssuerReference = {
  group: 'cert-manager.io',
  kind: 'Issuer',
  name: 'compartment-platform',
};

const registryValuesSchema: z.ZodType<KubernetesInstallRegistrySourceValues> = z
  .object({
    registry: z
      .object({
        hostname: z.string().optional(),
        issuerRef: kubernetesInstallRegistryIssuerValueFieldsSchema.optional(),
      })
      .passthrough()
      .optional(),
    tls: kubernetesInstallTlsValueFieldsSchema.optional(),
  })
  .passthrough();

export async function resolveKubernetesInstallRegistryConfiguration(
  input: ResolveKubernetesInstallRegistryInput,
): Promise<KubernetesInstallRegistryConfiguration> {
  const parsed: YamlFileValue = await readYamlFile(input.valuesPath, 'operator values file');
  const result: z.SafeParseReturnType<YamlFileValue, KubernetesInstallRegistrySourceValues> =
    registryValuesSchema.safeParse(parsed);
  if (!result.success) {
    throw formatSchemaValidationError(result.error, input.valuesPath);
  }
  const values: KubernetesInstallRegistrySourceValues = result.data;
  if (input.domainMode === 'managed') {
    return readManagedRegistryConfiguration(values.registry);
  }
  return readOperatorRegistryConfiguration(requireOperatorBaseDomain(input.baseDomain), values);
}

function readManagedRegistryConfiguration(
  registry: KubernetesInstallRegistryValueFields | undefined,
): KubernetesInstallRegistryConfiguration {
  const hostname: string = (registry?.hostname ?? '').trim().toLowerCase();
  return {
    registryHostname: hostname,
    registryIssuerRef:
      registry?.issuerRef === undefined ? defaultPlatformIssuer : requireRegistryIssuer(registry.issuerRef),
  };
}

function readOperatorRegistryConfiguration(
  baseDomain: string,
  values: KubernetesInstallRegistrySourceValues,
): KubernetesInstallRegistryConfiguration {
  assertOperatorPlatformTlsConfiguration(baseDomain, values);
  const hostname: string = buildPrivateRegistryHost(baseDomain);
  if (!isValidDnsHostname(hostname)) {
    throw new Error(`The operator-owned base domain cannot form a valid private registry hostname: ${hostname}.`);
  }
  const configuredHostname: string = (values.registry?.hostname ?? '').trim().toLowerCase();
  if (configuredHostname !== '' && configuredHostname !== hostname) {
    throw new Error(
      `registry.hostname must be ${hostname} for the operator-owned base domain; remove the override and retry.`,
    );
  }
  const issuer: KubernetesInstallRegistryIssuerReference =
    values.registry?.issuerRef === undefined
      ? readPlatformIssuer(values.tls?.issuerRef)
      : requireRegistryIssuer(values.registry.issuerRef);
  return { registryHostname: hostname, registryIssuerRef: issuer };
}

function assertOperatorPlatformTlsConfiguration(
  baseDomain: string,
  values: KubernetesInstallRegistrySourceValues,
): void {
  if (isReservedKubernetesInstallLocalhostDomain(baseDomain)) {
    return;
  }
  if (values.tls?.issuerRef === undefined && (values.tls?.existingSecret ?? '').trim() === '') {
    throw new Error(
      'tls.issuerRef or tls.existingSecret is required in --values for an operator-owned public base domain.',
    );
  }
  if ((values.tls?.existingSecret ?? '').trim() !== '' && values.registry?.issuerRef === undefined) {
    throw new Error(
      'registry.issuerRef is required in --values when operator TLS uses tls.existingSecret because the private registry needs its own Certificate.',
    );
  }
}

function readPlatformIssuer(issuerRef: DomainIssuerReference | undefined): KubernetesInstallRegistryIssuerReference {
  return issuerRef === undefined
    ? defaultPlatformIssuer
    : { group: 'cert-manager.io', kind: issuerRef.kind, name: issuerRef.name };
}

function requireRegistryIssuer(
  issuerRef: KubernetesInstallRegistryIssuerValueFields | undefined,
): KubernetesInstallRegistryIssuerReference {
  if (issuerRef === undefined) {
    throw new Error('registry.issuerRef.name and registry.issuerRef.kind are required in --values.');
  }
  return { group: 'cert-manager.io', kind: issuerRef.kind, name: issuerRef.name };
}

function requireOperatorBaseDomain(baseDomain: string | undefined): string {
  if (baseDomain !== undefined && baseDomain !== '') {
    return baseDomain;
  }
  throw new Error('Cannot derive registry.hostname without an operator-owned base domain.');
}
