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
  publicProtocol?: 'http' | 'https' | undefined;
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
  return readOperatorRegistryConfiguration(
    requireOperatorBaseDomain(input.baseDomain),
    input.publicProtocol ?? 'http',
    values,
  );
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
  publicProtocol: 'http' | 'https',
  values: KubernetesInstallRegistrySourceValues,
): KubernetesInstallRegistryConfiguration {
  assertOperatorPlatformTlsConfiguration(baseDomain, publicProtocol, values);
  const issuer: KubernetesInstallRegistryIssuerReference = requireRegistryIssuer(values.registry?.issuerRef);
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
  publicProtocol: 'http' | 'https',
  values: KubernetesInstallRegistrySourceValues,
): void {
  if (isReservedKubernetesInstallLocalhostDomain(baseDomain)) {
    return;
  }
  if (values.tls?.issuerRef !== undefined) {
    throw new Error('tls.issuerRef is not supported for operator-owned domain TLS.');
  }
  const existingSecret: string = (values.tls?.existingSecret ?? '').trim();
  if (publicProtocol === 'https' && existingSecret === '') {
    throw new Error('tls.existingSecret is required in --values when operator TLS uses HTTPS.');
  }
  if (publicProtocol === 'http' && existingSecret !== '') {
    throw new Error('tls.existingSecret cannot be used when operator TLS uses external HTTP termination.');
  }
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
