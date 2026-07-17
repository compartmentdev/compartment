import { createHash } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { DomainHostPlan } from '@compartment/contracts';
import { immutableKubeName } from '@compartment/utils';
import { runCommand } from '../command-runner';
import type { CommandResult } from '../command-runner.types';
import {
  createKubernetesInstallMaterializedDirectory,
  resolveKubernetesChartPath,
  writeKubernetesInstallValues,
} from './kubernetes-install-helm.service';
import type {
  KubernetesDomainCertificateInput,
  KubernetesDomainHelmPlatformValues,
  KubernetesDomainHelmValues,
  KubernetesDomainReleaseUpdate,
  KubernetesOperatorTarget,
  StagedKubernetesDomainCertificate,
} from './kubernetes-operator.service.types';
import { readPendingKubernetesDomainTlsSecretName } from './kubernetes-system-domain-release-values.service';

const helmDomainTimeout: string = '10m';

export async function stageKubernetesDomainCertificate(
  input: KubernetesDomainCertificateInput,
  operationId: string,
): Promise<StagedKubernetesDomainCertificate> {
  const certificate: string = await readRequiredPemFile(input.certificateFile, 'certificate');
  const privateKey: string = await readRequiredPemFile(input.privateKeyFile, 'private key');
  const secretName: string = buildDomainTlsSecretName(input.releaseName, operationId);
  return {
    certificate,
    fingerprint: createHash('sha256').update(certificate).update('\0').update(privateKey).digest('hex'),
    privateKey,
    secretName,
  };
}

export async function applyRuntimeKubernetesDomainRelease(
  target: KubernetesOperatorTarget,
  hostPlan: DomainHostPlan,
  domainGeneration: number,
  operationId?: string,
): Promise<void> {
  const customTlsSecretName: string | undefined = resolveActiveTlsSecretName(target.releaseName, hostPlan, operationId);
  await applyKubernetesDomainRelease(target, {
    ...buildRuntimeTlsReleaseUpdate(hostPlan, customTlsSecretName),
    domainCommit: false,
    domainGeneration,
    hostPlan,
    ...(operationId === undefined ? {} : { pendingOperationId: operationId }),
  });
}

export async function commitActiveKubernetesDomainRelease(
  target: KubernetesOperatorTarget,
  hostPlan: DomainHostPlan,
  domainGeneration: number,
  operationId?: string,
): Promise<void> {
  const customTlsSecretName: string | undefined = await resolveCommitTlsSecretName(target, hostPlan, operationId);
  await applyKubernetesDomainRelease(target, {
    ...buildCommittedTlsReleaseUpdate(hostPlan, customTlsSecretName),
    domainCommit: true,
    domainGeneration,
    hostPlan,
    pendingOperationId: '',
  });
}

function buildRuntimeTlsReleaseUpdate(
  hostPlan: DomainHostPlan,
  customTlsSecretName: string | undefined,
): KubernetesDomainReleaseUpdate {
  if (hostPlan.tlsMode !== 'custom-cert') {
    return clearedOperatorTlsReleaseUpdate();
  }
  if (customTlsSecretName === undefined) {
    return {};
  }
  return { customTlsSecretName };
}

function buildCommittedTlsReleaseUpdate(
  hostPlan: DomainHostPlan,
  customTlsSecretName: string | undefined,
): KubernetesDomainReleaseUpdate {
  if (hostPlan.tlsMode !== 'custom-cert') {
    return clearedOperatorTlsReleaseUpdate();
  }
  if (customTlsSecretName === undefined) {
    return { pendingCertificate: '', pendingOperationId: '', pendingPrivateKey: '', pendingTlsSecretName: '' };
  }
  return {
    customTlsSecretName,
    operatorCertificate: '',
    operatorPrivateKey: '',
    operatorTlsSecretName: customTlsSecretName,
    pendingCertificate: '',
    pendingOperationId: '',
    pendingPrivateKey: '',
    pendingTlsSecretName: '',
  };
}

function clearedOperatorTlsReleaseUpdate(): KubernetesDomainReleaseUpdate {
  return {
    customTlsSecretName: '',
    operatorCertificate: '',
    operatorPrivateKey: '',
    operatorTlsSecretName: '',
    pendingCertificate: '',
    pendingOperationId: '',
    pendingPrivateKey: '',
    pendingTlsSecretName: '',
  };
}

async function resolveCommitTlsSecretName(
  target: KubernetesOperatorTarget,
  hostPlan: DomainHostPlan,
  operationId: string | undefined,
): Promise<string | undefined> {
  const operationSecretName: string | undefined = resolveActiveTlsSecretName(target.releaseName, hostPlan, operationId);
  if (operationSecretName !== undefined || hostPlan.tlsMode !== 'custom-cert') {
    return operationSecretName;
  }
  return await readPendingKubernetesDomainTlsSecretName(target);
}

function resolveActiveTlsSecretName(
  releaseName: string,
  hostPlan: DomainHostPlan,
  operationId: string | undefined,
): string | undefined {
  if (hostPlan.tlsMode !== 'custom-cert') {
    return '';
  }
  return operationId === undefined ? undefined : buildDomainTlsSecretName(releaseName, operationId);
}

export async function applyKubernetesDomainRelease(
  target: KubernetesOperatorTarget,
  values: KubernetesDomainReleaseUpdate,
): Promise<void> {
  const valuesPath: string = requireOperatorValuesPath(target.valuesPath);
  const materializedDirectory: string = await createKubernetesInstallMaterializedDirectory();
  try {
    await applyMaterializedDomainRelease(target, values, valuesPath, materializedDirectory);
  } finally {
    await rm(materializedDirectory, { force: true, recursive: true });
  }
}

async function applyMaterializedDomainRelease(
  target: KubernetesOperatorTarget,
  values: KubernetesDomainReleaseUpdate,
  valuesPath: string,
  materializedDirectory: string,
): Promise<void> {
  const chartPath: string = await resolveKubernetesChartPath(target, materializedDirectory);
  const domainValuesPath: string = resolve(materializedDirectory, 'domain-values.json');
  await writeKubernetesInstallValues(domainValuesPath, buildDomainHelmValues(values));
  const result: CommandResult = await runCommand(
    buildDomainHelmCommand(target, chartPath, valuesPath, domainValuesPath),
  );
  if (result.exitCode !== 0) {
    throw new Error(`Helm domain rollout failed: ${readCommandFailure(result)}`);
  }
}

function buildDomainHelmValues(values: KubernetesDomainReleaseUpdate): KubernetesDomainHelmValues {
  const platformValues: KubernetesDomainHelmPlatformValues | undefined =
    values.hostPlan === undefined
      ? undefined
      : buildDomainHelmPlatformValues(values.hostPlan, values.domainGeneration, values.domainCommit);
  return {
    ...(platformValues === undefined ? {} : { platform: platformValues }),
    customTls: {
      ...(values.customTlsSecretName === undefined ? {} : { existingSecret: values.customTlsSecretName }),
      ...(values.operatorCertificate === undefined ? {} : { operatorCertificate: values.operatorCertificate }),
      ...(values.operatorPrivateKey === undefined ? {} : { operatorPrivateKey: values.operatorPrivateKey }),
      ...(values.operatorTlsSecretName === undefined ? {} : { operatorSecretName: values.operatorTlsSecretName }),
      ...(values.pendingCertificate === undefined ? {} : { pendingCertificate: values.pendingCertificate }),
      ...(values.pendingOperationId === undefined ? {} : { pendingOperationId: values.pendingOperationId }),
      ...(values.pendingPrivateKey === undefined ? {} : { pendingPrivateKey: values.pendingPrivateKey }),
      ...(values.pendingTlsSecretName === undefined ? {} : { pendingSecretName: values.pendingTlsSecretName }),
    },
  };
}

function buildDomainHelmPlatformValues(
  hostPlan: DomainHostPlan,
  domainGeneration: number | undefined,
  domainCommit: boolean | undefined,
): KubernetesDomainHelmPlatformValues {
  if (domainGeneration === undefined || domainCommit === undefined) {
    throw new Error('A domain generation and commit decision are required when applying an active domain.');
  }
  return {
    baseDomain: hostPlan.baseDomain,
    domainCommit,
    domainGeneration,
    domainMode: hostPlan.domainKind === 'managed' ? 'managed' : 'custom',
    publicProtocol: hostPlan.publicScheme,
    tlsMode: hostPlan.caddyMode,
  };
}

function buildDomainHelmCommand(
  target: KubernetesOperatorTarget,
  chartPath: string,
  operatorValuesPath: string,
  domainValuesPath: string,
): string[] {
  return [
    'helm',
    'upgrade',
    target.releaseName,
    chartPath,
    '--namespace',
    target.namespace,
    '--reuse-values',
    '--values',
    resolve(operatorValuesPath),
    '--values',
    domainValuesPath,
    '--rollback-on-failure',
    '--wait',
    '--timeout',
    helmDomainTimeout,
    ...(target.kubeContext === undefined ? [] : ['--kube-context', target.kubeContext]),
  ];
}

function buildDomainTlsSecretName(releaseName: string, operationId: string): string {
  return immutableKubeName('domain-tls', `${releaseName}:${operationId}`);
}

async function readRequiredPemFile(path: string, label: string): Promise<string> {
  const contents: string = await readFile(resolve(path), 'utf8');
  if (contents.trim() === '') {
    throw new Error(`The ${label} file is empty.`);
  }
  return contents;
}

function requireOperatorValuesPath(value: string | undefined): string {
  if (value === undefined || value.trim() === '') {
    throw new Error('--values is required for a system-domain command that changes Kubernetes resources.');
  }
  return value;
}

function readCommandFailure(result: CommandResult): string {
  return [result.stderr.trim(), result.stdout.trim()].filter((value: string): boolean => value !== '').join('\n');
}
