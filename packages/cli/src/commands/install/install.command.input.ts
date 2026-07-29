import { isIP } from 'node:net';
import { isValidDnsHostname, normalizeDnsHostname } from '@compartment/utils';
import { validateInstallEmail, validateInstallOrganization, validatePassword } from '../../prompts/prompt.validation';
import type {
  KubernetesInstallDomainInput,
  KubernetesInstallInput,
  KubernetesInstallOwnerInput,
} from '../../services/kubernetes-install-input.service.types';
import type {
  KubernetesInstallInputValues,
  RequiredKubernetesInstallInputValues,
  ResolvedKubernetesInstallInput,
} from './install.command.input.types';
import { normalizeInstallBaseDomain } from './install.command.validation';

const defaultNamespace: string = 'compartment';
const defaultReleaseName: string = 'compartment';
const kubernetesNamePattern: RegExp = /^[a-z0-9](?:[-a-z0-9.]*[a-z0-9])?$/u;
const kubernetesLabelPattern: RegExp = /^[a-z0-9](?:[-a-z0-9]*[a-z0-9])?$/u;
const helmReleaseNamePattern: RegExp = /^[a-z0-9](?:[-a-z0-9]*[a-z0-9])?$/u;

export function resolveCanonicalKubernetesInstallInput(
  values: KubernetesInstallInputValues,
  kubeconfigPath: string,
): ResolvedKubernetesInstallInput {
  assertCanonicalKubernetesInstallDomainChoice(values);
  const required: RequiredKubernetesInstallInputValues = readRequiredValues(values);
  assertKubernetesNames(required);
  assertOwnerValues(required);
  return { input: buildInstallInput(values, required, kubeconfigPath) };
}

function buildInstallInput(
  values: KubernetesInstallInputValues,
  required: RequiredKubernetesInstallInputValues,
  kubeconfigPath: string,
): KubernetesInstallInput {
  return {
    domain: readDomain(values),
    ingressClass: required.ingressClass,
    ...(values.ingressEndpoint === undefined
      ? {}
      : { ingressEndpoint: normalizeIngressEndpoint(values.ingressEndpoint) }),
    kubeContext: required.kubeContext,
    kubeconfigPath,
    namespace: required.namespace,
    owner: readOwner(required),
    releaseName: required.releaseName,
    storageClass: required.storageClass,
    valuesPath: values.valuesPath,
  };
}

function readDomain(values: KubernetesInstallInputValues): KubernetesInstallDomainInput {
  return values.managedDomain === true
    ? { mode: 'managed' }
    : { baseDomain: normalizeInstallBaseDomain(requireInput(values.baseDomain, '--base-domain')), mode: 'operator' };
}

function readOwner(required: RequiredKubernetesInstallInputValues): KubernetesInstallOwnerInput {
  return {
    email: required.email,
    organizationName: required.organizationName,
    password: required.password,
  };
}

function readRequiredValues(values: KubernetesInstallInputValues): RequiredKubernetesInstallInputValues {
  return {
    email: requireInput(values.email, '--email'),
    ingressClass: requireInput(values.ingressClass, '--ingress-class'),
    kubeContext: requireInput(values.kubeContext, '--kube-context'),
    namespace: values.namespace ?? defaultNamespace,
    organizationName: requireInput(values.organization, '--organization'),
    password: requireInput(values.password, '--admin-password'),
    releaseName: values.releaseName ?? defaultReleaseName,
    storageClass: values.storageClass ?? '',
  };
}

function assertKubernetesNames(values: RequiredKubernetesInstallInputValues): void {
  assertName(values.namespace, '--namespace', 63, kubernetesLabelPattern);
  assertName(values.releaseName, '--release-name', 53, helmReleaseNamePattern);
  assertKubernetesName(values.ingressClass, '--ingress-class');
  if (values.storageClass !== '') {
    assertKubernetesName(values.storageClass, '--storage-class');
  }
}

function assertOwnerValues(values: RequiredKubernetesInstallInputValues): void {
  assertValidatedOwnerField('--email', values.email, validateInstallEmail);
  assertValidatedOwnerField('--organization', values.organizationName, validateInstallOrganization);
  assertValidatedOwnerField('--admin-password', values.password, validatePassword);
}

export function assertCanonicalKubernetesInstallDomainChoice(
  values: Pick<KubernetesInstallInputValues, 'baseDomain' | 'managedDomain'>,
): void {
  assertMutuallyExclusiveKubernetesInstallDomains(values);
  if (values.managedDomain !== true && values.baseDomain === undefined) {
    throw new Error('Missing required install input: --managed-domain or --base-domain.');
  }
}

export function assertMutuallyExclusiveKubernetesInstallDomains(
  values: Pick<KubernetesInstallInputValues, 'baseDomain' | 'managedDomain'>,
): void {
  if (values.managedDomain === true && values.baseDomain !== undefined) {
    throw new Error('--managed-domain cannot be combined with --base-domain.');
  }
}

function requireInput(value: string | undefined, field: string): string {
  if (value === undefined || value.trim() === '') {
    throw new Error(`Missing required install input: ${field}.`);
  }
  return value;
}

function assertKubernetesName(value: string, field: string): void {
  assertName(value, field, 253, kubernetesNamePattern);
}

function assertName(value: string, field: string, maximum: number, pattern: RegExp): void {
  if (value.length > maximum || !pattern.test(value)) {
    throw new Error(`${field} must be a valid Kubernetes name.`);
  }
}

function normalizeIngressEndpoint(value: string): string {
  if (isIP(value) !== 0) {
    return value.toLowerCase();
  }
  if (/^[\d.]+$/u.test(value) || value.includes(':')) {
    throw new Error('--ingress-endpoint must be an IP address or DNS hostname.');
  }
  const normalized: string = normalizeDnsHostname(value);
  if (!isValidDnsHostname(normalized)) {
    throw new Error('--ingress-endpoint must be an IP address or DNS hostname.');
  }
  return normalized;
}

function assertValidatedOwnerField(
  field: '--admin-password' | '--email' | '--organization',
  value: string,
  validate: (candidate: string) => string | undefined,
): void {
  const error: string | undefined = validate(value);
  if (error !== undefined) {
    throw new Error(`${field}: ${error}`);
  }
}
