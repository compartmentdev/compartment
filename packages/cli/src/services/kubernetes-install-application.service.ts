import { rm } from 'node:fs/promises';
import { installKubernetesOwner } from '../install';
import type { CliInstallResult } from '../install.types';
import { runKubernetesExistingClusterPreflight } from './kubernetes-existing-cluster-preflight.service';
import { createKubernetesInstallMaterializedDirectory } from './kubernetes-install-helm.service';
import { prepareKubernetesInstallHelmMaterial } from './kubernetes-install-material.service';
import { readManagedDomainRequestedLabelSource } from './managed-domain-label.service';
import { runObservableInstallStep } from './kubernetes-install-progress.service';
import { deployAndWaitForKubernetesInstall } from './kubernetes-install.service';
import type {
  KubernetesInstallDeploymentInput,
  KubernetesInstallDeploymentResult,
} from './kubernetes-install.service.types';
import type {
  KubernetesInstallApplicationInput,
  KubernetesInstallApplicationResult,
} from './kubernetes-install-input.service.types';

export async function installIntoKubernetes(
  input: KubernetesInstallApplicationInput,
): Promise<KubernetesInstallApplicationResult> {
  const deploymentInput: KubernetesInstallDeploymentInput = buildDeploymentInput(input);
  await runCanonicalPreflight(input, deploymentInput);
  const deployment: KubernetesInstallDeploymentResult = await deployAndWaitForKubernetesInstall(deploymentInput);
  return { install: await createOwner(input, deployment) };
}

async function runCanonicalPreflight(
  input: KubernetesInstallApplicationInput,
  deploymentInput: KubernetesInstallDeploymentInput,
): Promise<void> {
  await runObservableInstallStep(input.progress, 'Checking existing Kubernetes cluster', async (): Promise<void> => {
    await runKubernetesExistingClusterPreflight({
      apiHosts: readExpectedIngressHosts(input),
      install: input,
    });
    await verifyInstallImages(deploymentInput);
  });
}

async function verifyInstallImages(input: KubernetesInstallDeploymentInput): Promise<void> {
  const directory: string = await createKubernetesInstallMaterializedDirectory();
  try {
    await prepareKubernetesInstallHelmMaterial(input, directory);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}

function buildDeploymentInput(input: KubernetesInstallApplicationInput): KubernetesInstallDeploymentInput {
  return {
    acmeEmail: input.owner.email,
    ...(input.apiUrl === undefined ? {} : { apiUrl: input.apiUrl }),
    ...(input.domain.mode === 'operator' ? { baseDomain: input.domain.baseDomain } : {}),
    ...(input.brokerUrl === undefined ? {} : { brokerUrl: input.brokerUrl }),
    ...(input.chartPath === undefined ? {} : { chartPath: input.chartPath }),
    domainMode: input.domain.mode === 'managed' ? 'managed' : 'custom',
    kubeconfigPath: input.kubeconfigPath,
    kubeContext: input.kubeContext,
    ...(input.domain.mode === 'managed'
      ? {
          managedDomainRequestedLabelSource: readManagedDomainRequestedLabelSource(
            input.owner.organizationName,
            input.organizationSlug,
          ),
        }
      : {}),
    namespace: input.namespace,
    progress: input.progress,
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
  return [`console.${input.domain.baseDomain}`];
}
