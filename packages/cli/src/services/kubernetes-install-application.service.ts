import { rm } from 'node:fs/promises';
import type { DomainIssuerReference } from '@compartment/contracts';
import { installKubernetesOwner } from '../install';
import type { CliInstallResult } from '../install.types';
import { runKubernetesExistingClusterPreflight } from './kubernetes-existing-cluster-preflight.service';
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
  KubernetesInstallDomainMode,
} from './kubernetes-install.service.types';
import type {
  KubernetesInstallApplicationInput,
  KubernetesInstallApplicationResult,
} from './kubernetes-install-input.service.types';
import {
  readKubernetesTlsIssuerReference,
  readOperatorOwnedKubernetesTlsSecretName,
  usesOperatorOwnedKubernetesTlsSecret,
} from './kubernetes-install-tls.service';
import { assertManagedDomainOnboardingAvailable } from './managed-domain-reservation-token.service';
import { isReservedKubernetesInstallLocalhostDomain } from '../kubernetes-install-domain';
import type { KubernetesOperatorIssuerAssessment } from './kubernetes-operator-issuer-trust.service.types';

export async function installIntoKubernetes(
  input: KubernetesInstallApplicationInput,
): Promise<KubernetesInstallApplicationResult> {
  if (input.domain.mode === 'managed') {
    assertManagedDomainOnboardingAvailable();
  }
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
      install: input,
    });
    await verifyInstallImages(deploymentInput);
  });
}

async function verifyOperatorCertificateSources(input: KubernetesInstallDeploymentInput): Promise<void> {
  if (input.domainMode !== 'custom') {
    return;
  }
  reportIssuerTrustWarning(input, await assertOperatorRegistryIssuer(input));
  if (isReservedKubernetesInstallLocalhostDomain(input.baseDomain)) {
    return;
  }
  if (await usesOperatorOwnedKubernetesTlsSecret(input.valuesPath)) {
    await assertOperatorTlsSecret(input, await readOperatorOwnedKubernetesTlsSecretName(input.valuesPath));
    return;
  }
  const platformIssuer: DomainIssuerReference = await readKubernetesTlsIssuerReference(input.valuesPath);
  if (platformIssuer.kind !== input.registryIssuerRef.kind || platformIssuer.name !== input.registryIssuerRef.name) {
    reportIssuerTrustWarning(
      input,
      await assertOperatorRegistryIssuer({
        ...input,
        registryIssuerRef: { group: 'cert-manager.io', ...platformIssuer },
      }),
    );
  }
}

function reportIssuerTrustWarning(
  input: KubernetesInstallDeploymentInput,
  assessment: KubernetesOperatorIssuerAssessment,
): void {
  if (assessment.trust === 'acme') {
    return;
  }
  input.progress?.report(`TLS trust warning: ${assessment.detail}`, { renderMode: 'line' });
}

async function verifyInstallImages(input: KubernetesInstallDeploymentInput): Promise<void> {
  const directory: string = await createKubernetesInstallMaterializedDirectory();
  try {
    await prepareKubernetesInstallHelmMaterial(input, directory);
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
    valuesPath: input.valuesPath,
  });
  return buildResolvedDeploymentInput(input, domainMode, registry);
}

function buildResolvedDeploymentInput(
  input: KubernetesInstallApplicationInput,
  domainMode: KubernetesInstallDomainMode,
  registry: KubernetesInstallRegistryConfiguration,
): KubernetesInstallDeploymentInput {
  return {
    acmeEmail: input.owner.email,
    ...(input.apiUrl === undefined ? {} : { apiUrl: input.apiUrl }),
    ...(input.domain.mode === 'operator' ? { baseDomain: input.domain.baseDomain } : {}),
    ...(input.brokerUrl === undefined ? {} : { brokerUrl: input.brokerUrl }),
    ...(input.chartPath === undefined ? {} : { chartPath: input.chartPath }),
    domainMode,
    kubeconfigPath: input.kubeconfigPath,
    kubeContext: input.kubeContext,
    managedDomainRequestedLabelSource:
      input.domain.mode === 'managed'
        ? readManagedDomainRequestedLabelSource(input.owner.organizationName, input.organizationSlug)
        : undefined,
    namespace: input.namespace,
    progress: input.progress,
    ...registry,
    releaseName: input.releaseName,
    valuesPath: input.valuesPath,
  };
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
