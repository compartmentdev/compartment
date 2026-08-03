import type { DomainIssuerReference } from '@compartment/contracts';
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
  assertRegistryHostnameIsDerived(values.registry);
  if (input.domainMode === 'managed') {
    return readManagedRegistryConfiguration(values.registry);
  }
  return readOperatorRegistryConfiguration(requireOperatorBaseDomain(input.baseDomain), values);
}

function readManagedRegistryConfiguration(
  registry: KubernetesInstallRegistryValueFields | undefined,
): KubernetesInstallRegistryConfiguration {
  return {
    registryHostname: '',
    registryIssuerRef: requireRegistryIssuer(registry?.issuerRef),
  };
}

function readOperatorRegistryConfiguration(
  baseDomain: string,
  values: KubernetesInstallRegistrySourceValues,
): KubernetesInstallRegistryConfiguration {
  assertOperatorPlatformTlsConfiguration(baseDomain, values);
  const issuer: KubernetesInstallRegistryIssuerReference =
    values.registry?.issuerRef === undefined
      ? readPlatformIssuer(values.tls?.issuerRef)
      : requireRegistryIssuer(values.registry.issuerRef);
  return { registryHostname: '', registryIssuerRef: issuer };
}

function assertRegistryHostnameIsDerived(registry: KubernetesInstallRegistryValueFields | undefined): void {
  if ((registry?.hostname ?? '').trim() !== '') {
    throw new Error(
      'registry.hostname is derived from the retained registry Service ClusterIP and cannot be configured.',
    );
  }
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
  if (issuerRef === undefined) {
    throw new Error('registry.issuerRef or tls.issuerRef must reference a CA trusted by every Kubernetes node.');
  }
  return { group: 'cert-manager.io', kind: issuerRef.kind, name: issuerRef.name };
}

function requireRegistryIssuer(
  issuerRef: KubernetesInstallRegistryIssuerValueFields | undefined,
): KubernetesInstallRegistryIssuerReference {
  if (issuerRef === undefined) {
    throw new Error(
      'registry.issuerRef.name and registry.issuerRef.kind are required in --values and must reference a CA trusted by every Kubernetes node.',
    );
  }
  return { group: 'cert-manager.io', kind: issuerRef.kind, name: issuerRef.name };
}

function requireOperatorBaseDomain(baseDomain: string | undefined): string {
  if (baseDomain !== undefined && baseDomain !== '') {
    return baseDomain;
  }
  throw new Error('Custom-domain install requires an operator-owned base domain.');
}
