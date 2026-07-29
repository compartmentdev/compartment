import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { DomainHostPlan } from '@compartment/contracts';
import { runCommand } from '../command-runner';
import type { CommandResult } from '../command-runner.types';
import { readCommandOutput } from './kubernetes-command.support';
import { mapDomainTlsModeToPlatformTlsMode } from './kubernetes-domain-tls-mode.service';
import {
  createKubernetesInstallMaterializedDirectory,
  resolveKubernetesChartPath,
  writeKubernetesInstallValues,
} from './kubernetes-install-helm.service';
import { writeVerifiedKubernetesReleaseImageValues } from './kubernetes-image-trust.service';
import type {
  KubernetesDomainHelmPlatformValues,
  KubernetesDomainHelmValues,
  KubernetesDomainReleaseUpdate,
  KubernetesOperatorTarget,
} from './kubernetes-operator.service.types';
import { buildDomainHelmCommand, requireOperatorValuesPath } from './kubernetes-system-domain-release.support';

export async function applyRuntimeKubernetesDomainRelease(
  target: KubernetesOperatorTarget,
  hostPlan: DomainHostPlan,
  domainGeneration: number,
): Promise<void> {
  await applyKubernetesDomainRelease(target, {
    domainCommit: false,
    domainGeneration,
    hostPlan,
  });
}

export async function commitActiveKubernetesDomainRelease(
  target: KubernetesOperatorTarget,
  hostPlan: DomainHostPlan,
  domainGeneration: number,
): Promise<void> {
  await applyKubernetesDomainRelease(target, {
    domainCommit: true,
    domainGeneration,
    hostPlan,
  });
}

async function applyKubernetesDomainRelease(
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
  const imageTrustValuesPath: string = resolve(materializedDirectory, 'image-trust-values.json');
  await writeVerifiedKubernetesReleaseImageValues({
    ...(target.kubeContext === undefined ? {} : { kubeContext: target.kubeContext }),
    ...(target.kubeconfigPath === undefined ? {} : { kubeconfigPath: target.kubeconfigPath }),
    namespace: target.namespace,
    operatorValuesPaths: [valuesPath],
    outputPath: imageTrustValuesPath,
    releaseName: target.releaseName,
  });
  await writeKubernetesInstallValues(domainValuesPath, buildDomainHelmValues(values));
  const result: CommandResult = await runCommand(
    buildDomainHelmCommand(target, chartPath, valuesPath, domainValuesPath, imageTrustValuesPath),
  );
  if (result.exitCode !== 0) {
    throw new Error(`Helm domain rollout failed: ${readCommandOutput(result)}`);
  }
}

function buildDomainHelmValues(values: KubernetesDomainReleaseUpdate): KubernetesDomainHelmValues {
  const platformValues: KubernetesDomainHelmPlatformValues | undefined =
    values.hostPlan === undefined
      ? undefined
      : buildDomainHelmPlatformValues(values.hostPlan, values.domainGeneration, values.domainCommit);
  return {
    ...(platformValues === undefined ? {} : { platform: platformValues }),
    ...(values.hostPlan?.issuerRef === undefined ? {} : { tls: { issuerRef: values.hostPlan.issuerRef } }),
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
    tlsMode: mapDomainTlsModeToPlatformTlsMode(hostPlan.tlsMode),
  };
}
