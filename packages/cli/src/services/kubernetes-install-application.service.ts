import { rm } from 'node:fs/promises';
import { isIP } from 'node:net';
import { installKubernetesOwner } from '../install';
import type { CliInstallResult } from '../install.types';
import { runKubernetesExistingClusterPreflight } from './kubernetes-existing-cluster-preflight.service';
import { readCompartmentChartFullname } from './kubernetes-chart-name';
import {
  assertOperatorRegistryIssuer,
  assertOperatorTlsSecret,
} from './kubernetes-existing-cluster-preflight.cert-manager';
import { createKubernetesInstallMaterializedDirectory } from './kubernetes-install-helm.service';
import { prepareKubernetesInstallHelmMaterial } from './kubernetes-install-material.service';
import { readManagedDomainRequestedLabelSource } from './managed-domain-label.service';
import { runObservableInstallStep } from './kubernetes-install-progress.service';
import { resolveKubernetesInstallRegistryConfiguration } from './kubernetes-install-registry.service';
import type { KubernetesInstallRegistryConfiguration } from './kubernetes-install-registry.service.types';
import { deployAndWaitForKubernetesInstall } from './kubernetes-install.service';
import type {
  KubernetesInstallDeploymentInput,
  KubernetesInstallDeploymentResult,
  KubernetesResolvedDeploymentProperties,
  KubernetesInstallDomainMode,
  KubernetesInstallHelmMaterial,
  KubernetesIngressEndpoint,
} from './kubernetes-install.service.types';
import type {
  KubernetesInstallApplicationInput,
  KubernetesInstallApplicationResult,
} from './kubernetes-install-input.service.types';
import { readOperatorOwnedKubernetesTlsSecretName } from './kubernetes-install-tls.service';
import { isReservedKubernetesInstallLocalhostDomain } from '../kubernetes-install-domain';
import { assertRegistryIpIssuerAssessment } from './kubernetes-operator-issuer-trust.service';
import { verifyKubernetesSandboxRuntime } from './kubernetes-sandbox-runtime-preflight.service';
import type { KubernetesSandboxRuntimeVerification } from './kubernetes-sandbox-runtime-preflight.service.types';
import { resolveKubernetesSandboxRuntimeClassName } from './kubernetes-sandbox-runtime-values.service';
import { readKubernetesChartValues } from './kubernetes-chart-values.service';

export async function installIntoKubernetes(
  input: KubernetesInstallApplicationInput,
): Promise<KubernetesInstallApplicationResult> {
  const deploymentInput: KubernetesInstallDeploymentInput = await buildDeploymentInput(input);
  await runCanonicalPreflight(input, deploymentInput);
  const deployment: KubernetesInstallDeploymentResult = await deployAndWaitForKubernetesInstall(deploymentInput);
  return { install: await createOwner(input, deployment) };
}

async function runCanonicalPreflight(
  input: KubernetesInstallApplicationInput,
  deploymentInput: KubernetesInstallDeploymentInput,
): Promise<void> {
  await runObservableInstallStep(input.progress, 'Checking existing Kubernetes cluster', async (): Promise<void> => {
    await verifyOperatorCertificateSources(deploymentInput);
    await runKubernetesExistingClusterPreflight({
      apiHosts: readExpectedIngressHosts(input),
      chartFullname: deploymentInput.chartFullname,
      install: input,
    });
    const runtimeClassName: string = await resolveInstallSandboxRuntime(deploymentInput);
    reportSandboxRuntimeVerification(input, await inspectSandboxRuntime(input, runtimeClassName));
  });
}

async function inspectSandboxRuntime(
  input: KubernetesInstallApplicationInput,
  runtimeClassName: string,
): Promise<KubernetesSandboxRuntimeVerification> {
  return await verifyKubernetesSandboxRuntime({
    kubeContext: input.kubeContext,
    kubeconfigPath: input.kubeconfigPath,
    runtimeClassName,
  });
}

function reportSandboxRuntimeVerification(
  input: KubernetesInstallApplicationInput,
  assessment: KubernetesSandboxRuntimeVerification,
): void {
  input.progress.report(assessment.detail, { renderMode: 'line' });
}

async function verifyOperatorCertificateSources(input: KubernetesInstallDeploymentInput): Promise<void> {
  assertRegistryIpIssuerAssessment(await assertOperatorRegistryIssuer(input));
  if (input.domainMode !== 'custom' || input.publicProtocol !== 'https') {
    return;
  }
  if (isReservedKubernetesInstallLocalhostDomain(input.baseDomain)) {
    return;
  }
  await assertOperatorTlsSecret(input, await readOperatorOwnedKubernetesTlsSecretName(input.valuesPath));
}

async function resolveInstallSandboxRuntime(input: KubernetesInstallDeploymentInput): Promise<string> {
  const directory: string = await createKubernetesInstallMaterializedDirectory();
  try {
    const material: KubernetesInstallHelmMaterial = await prepareKubernetesInstallHelmMaterial(input, directory);
    return await resolveKubernetesSandboxRuntimeClassName(
      await readKubernetesChartValues(material.chartPath),
      input.valuesPath,
    );
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}

async function buildDeploymentInput(
  input: KubernetesInstallApplicationInput,
): Promise<KubernetesInstallDeploymentInput> {
  const domainMode: KubernetesInstallDomainMode = input.domain.mode === 'managed' ? 'managed' : 'custom';
  const registry: KubernetesInstallRegistryConfiguration = await resolveKubernetesInstallRegistryConfiguration({
    ...(input.domain.mode === 'operator' ? { baseDomain: input.domain.baseDomain } : {}),
    domainMode,
    ...(input.domain.mode === 'operator' ? { publicProtocol: input.domain.publicProtocol } : {}),
    valuesPath: input.valuesPath,
  });
  const resolved: KubernetesResolvedDeploymentProperties = {
    ...registry,
    chartFullname: await readCompartmentChartFullname(input.releaseName, input.valuesPath),
  };
  return buildResolvedDeploymentInput(input, domainMode, resolved);
}

function buildResolvedDeploymentInput(
  input: KubernetesInstallApplicationInput,
  domainMode: KubernetesInstallDomainMode,
  resolved: KubernetesResolvedDeploymentProperties,
): KubernetesInstallDeploymentInput {
  return {
    acmeEmail: input.owner.email,
    ...(input.apiUrl === undefined ? {} : { apiUrl: input.apiUrl }),
    ...buildDeploymentDomainValues(input),
    ...(input.brokerUrl === undefined ? {} : { brokerUrl: input.brokerUrl }),
    ...(input.chartPath === undefined ? {} : { chartPath: input.chartPath }),
    clearConfiguredIngressEndpoint: input.clearIngressEndpoint,
    configuredIngressEndpoint: buildConfiguredIngressEndpoint(input.ingressEndpoint),
    domainMode,
    ingressClassName: input.ingressClass,
    kubeconfigPath: input.kubeconfigPath,
    kubeContext: input.kubeContext,
    managedDomainRequestedLabelSource: resolveManagedDomainLabel(input),
    namespace: input.namespace,
    progress: input.progress,
    ...resolved,
    releaseName: input.releaseName,
    valuesPath: input.valuesPath,
  };
}

function buildDeploymentDomainValues(
  input: KubernetesInstallApplicationInput,
): Pick<KubernetesInstallDeploymentInput, 'baseDomain' | 'publicProtocol'> {
  return input.domain.mode === 'operator'
    ? { baseDomain: input.domain.baseDomain, publicProtocol: input.domain.publicProtocol }
    : { publicProtocol: 'https' };
}

function resolveManagedDomainLabel(input: KubernetesInstallApplicationInput): string | undefined {
  return input.domain.mode === 'managed'
    ? readManagedDomainRequestedLabelSource(input.owner.organizationName, input.organizationSlug)
    : undefined;
}

function buildConfiguredIngressEndpoint(value: string | undefined): KubernetesIngressEndpoint | null {
  if (value === undefined) {
    return null;
  }
  const version: number = isIP(value);
  if (version === 4) {
    return { type: 'A', value };
  }
  return { type: version === 6 ? 'AAAA' : 'hostname', value };
}

async function createOwner(
  input: KubernetesInstallApplicationInput,
  deployment: KubernetesInstallDeploymentResult,
): Promise<CliInstallResult> {
  return await runObservableInstallStep(
    input.progress,
    'Creating owner',
    async (): Promise<CliInstallResult> =>
      await installKubernetesOwner(deployment.apiUrl, deployment.installToken, {
        adminEmail: input.owner.email,
        adminPassword: input.owner.password,
        baseDomain: deployment.baseDomain,
        organizationName: input.owner.organizationName,
        ...(input.organizationSlug === undefined ? {} : { organizationSlug: input.organizationSlug }),
      }),
  );
}

function readExpectedIngressHosts(input: KubernetesInstallApplicationInput): string[] {
  if (input.domain.mode === 'managed') {
    return [];
  }
  return [`console.${input.domain.baseDomain}`, `*.${input.domain.baseDomain}`];
}
