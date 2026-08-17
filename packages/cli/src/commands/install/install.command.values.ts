import { join } from 'node:path';
import type { DomainIssuerReference } from '@compartment/contracts';
import { z } from 'zod';
import {
  createKubernetesInstallMaterializedDirectory,
  writeKubernetesInstallValues,
} from '../../services/kubernetes-install-helm.service';
import { kubernetesInstallRegistryIssuerValueFieldsSchema } from '../../services/kubernetes-install-registry-values.schema';
import type { KubernetesInstallRegistryIssuerValueFields } from '../../services/kubernetes-install-registry.service.types';
import type { InstallWizardValues } from './install.command.types';
import { formatSchemaValidationError } from '../../services/schema-validation-error';
import { readYamlFile, type YamlFileObject, type YamlFileValue } from '../../services/yaml-file';
import { kubernetesResourceNameSchema } from '../../services/kubernetes-resource-name';

export interface MaterializedInstallWizardValues {
  directory: string;
  path: string;
}

export interface OperatorInstallInputValues {
  clearIngressEndpoint: boolean;
  ingressClass: string;
  ingressEndpoint?: string | undefined;
  publicProtocol?: 'http' | 'https' | undefined;
  storageClass: string;
}

interface OperatorInstallValuesDocument {
  ingress?: OperatorInstallIngressValues | undefined;
  platform?: OperatorInstallPlatformValues | undefined;
  registry?: OperatorInstallRegistryValues | undefined;
  storage?: OperatorInstallStorageValues | undefined;
  tls?: OperatorInstallTlsValues | undefined;
}

interface OperatorInstallPlatformValues {
  publicProtocol?: 'http' | 'https' | undefined;
}

interface OperatorInstallIngressValues {
  className: string;
  endpoint?: OperatorInstallIngressEndpoint | undefined;
}

interface OperatorInstallIngressEndpoint {
  type: 'A' | 'AAAA' | 'hostname' | '';
  value: string;
}

interface OperatorInstallStorageValues {
  storageClass?: string | undefined;
}

interface OperatorInstallRegistryValues {
  issuerRef?: KubernetesInstallRegistryIssuerValueFields | undefined;
}

interface OperatorInstallTlsValues {
  existingSecret?: string | undefined;
  issuerRef?: DomainIssuerReference | undefined;
}

const issuerReferenceSchema: z.ZodType<DomainIssuerReference> = z
  .object({
    kind: z.enum(['Issuer', 'ClusterIssuer']),
    name: kubernetesResourceNameSchema,
  })
  .strict();
const operatorInstallValuesSchema: z.ZodType<OperatorInstallValuesDocument> = z
  .object({
    ingress: z
      .object({
        className: z.string().trim().min(1, 'must not be empty'),
        endpoint: z
          .object({ type: z.enum(['', 'A', 'AAAA', 'hostname']), value: z.string() })
          .strict()
          .optional(),
      })
      .passthrough()
      .optional(),
    platform: z
      .object({ publicProtocol: z.enum(['http', 'https']).optional() })
      .passthrough()
      .optional(),
    registry: z
      .object({ issuerRef: kubernetesInstallRegistryIssuerValueFieldsSchema.optional() })
      .passthrough()
      .optional(),
    storage: z.object({ storageClass: z.string() }).passthrough().optional(),
    tls: z
      .object({
        existingSecret: kubernetesResourceNameSchema.or(z.literal('')).optional(),
        issuerRef: issuerReferenceSchema.optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export async function materializeInstallWizardValues(
  values: InstallWizardValues,
): Promise<MaterializedInstallWizardValues> {
  const directory: string = await createKubernetesInstallMaterializedDirectory();
  const path: string = join(directory, 'values.json');
  await writeKubernetesInstallValues(path, values);
  return { directory, path };
}

export async function readOperatorInstallInputValues(
  valuesPath: string,
  requireOperatorTls: boolean,
): Promise<OperatorInstallInputValues> {
  const parsed: YamlFileValue = await readYamlFile(valuesPath, 'operator values file');
  const result: z.SafeParseReturnType<YamlFileValue, OperatorInstallValuesDocument> =
    operatorInstallValuesSchema.safeParse(parsed);
  const issues: z.ZodIssue[] = [
    ...(result.success ? [] : result.error.issues),
    ...listRequiredOperatorValueIssues(parsed, requireOperatorTls),
  ];
  if (issues.length !== 0) {
    throw formatSchemaValidationError(new z.ZodError(issues), valuesPath);
  }
  if (!result.success) {
    throw new Error(`${valuesPath}: (root): operator values validation failed`);
  }
  return readOperatorInputValues(result.data, requireOperatorTls);
}

function listRequiredOperatorValueIssues(parsed: YamlFileValue, requireOperatorTls: boolean): z.ZodIssue[] {
  const values: YamlFileObject | undefined = readYamlObject(parsed);
  const issues: z.ZodIssue[] = [];
  if (values?.ingress === undefined) {
    issues.push({
      code: z.ZodIssueCode.custom,
      message: 'is required and must define className',
      path: ['ingress'],
    });
  }
  if (requireOperatorTls) {
    issues.push(...listRequiredOperatorTlsIssues(values));
  }
  return issues;
}

function listRequiredOperatorTlsIssues(values: YamlFileObject | undefined): z.ZodIssue[] {
  const platform: YamlFileObject | undefined = readYamlObject(values?.platform);
  const tls: YamlFileObject | undefined = readYamlObject(values?.tls);
  const registry: YamlFileObject | undefined = readYamlObject(values?.registry);
  const existingSecret: string = typeof tls?.existingSecret === 'string' ? tls.existingSecret.trim() : '';
  const hasIssuer: boolean = tls?.issuerRef !== undefined;
  const publicProtocol: string = readOperatorPublicProtocol(platform, existingSecret, hasIssuer);
  const issues: z.ZodIssue[] = [];
  issues.push(...listOperatorProtocolIssues(publicProtocol, existingSecret, hasIssuer));
  if (registry?.issuerRef === undefined) {
    issues.push({
      code: z.ZodIssueCode.custom,
      message: 'is required because the private registry needs a Certificate',
      path: ['registry', 'issuerRef'],
    });
  }
  return issues;
}

function readOperatorPublicProtocol(
  platform: YamlFileObject | undefined,
  existingSecret: string,
  hasIssuer: boolean,
): string {
  if (typeof platform?.publicProtocol === 'string') {
    return platform.publicProtocol;
  }
  return existingSecret !== '' || hasIssuer ? 'https' : 'http';
}

function listOperatorProtocolIssues(publicProtocol: string, existingSecret: string, hasIssuer: boolean): z.ZodIssue[] {
  const hasTlsSource: boolean = existingSecret !== '' || hasIssuer;
  if (publicProtocol === 'https' && !hasTlsSource) {
    return [
      operatorValueIssue('tls.existingSecret or tls.issuerRef is required when platform.publicProtocol is https'),
    ];
  }
  if (publicProtocol === 'http' && hasTlsSource) {
    return [operatorValueIssue('TLS sources cannot be used when platform.publicProtocol is http')];
  }
  return [];
}

function operatorValueIssue(message: string): z.ZodIssue {
  return { code: z.ZodIssueCode.custom, message, path: ['tls', 'existingSecret'] };
}

function readYamlObject(value: YamlFileValue | undefined): YamlFileObject | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : undefined;
}

function readOperatorInputValues(
  values: OperatorInstallValuesDocument,
  includePublicProtocol: boolean,
): OperatorInstallInputValues {
  const existingSecret: string = values.tls?.existingSecret?.trim() ?? '';
  const hasIssuer: boolean = values.tls?.issuerRef !== undefined;
  return {
    clearIngressEndpoint: values.ingress?.endpoint?.value === '',
    ingressClass: values.ingress?.className ?? '',
    ...(values.ingress?.endpoint?.value === undefined || values.ingress.endpoint.value === ''
      ? {}
      : { ingressEndpoint: values.ingress.endpoint.value }),
    ...(includePublicProtocol
      ? { publicProtocol: values.platform?.publicProtocol ?? (existingSecret !== '' || hasIssuer ? 'https' : 'http') }
      : {}),
    storageClass: values.storage?.storageClass ?? '',
  };
}
