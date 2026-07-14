import { Buffer } from 'node:buffer';
import {
  createSelfCleaningKubeRuntimeFromEnvironment,
  projectNamespaceProvisioningBundle,
  type ApplyBundle,
  type ProjectNetworkPolicyProjection,
  type ProjectNamespaceProvisioningRow,
} from '@compartment/kube-runtime';
import { z } from 'zod';

interface ProjectProvisionerJobEnvironment {
  COMPARTMENT_ARTIFACT_REGISTRY_HOST: string;
  COMPARTMENT_ARTIFACT_REGISTRY_PORT: number;
  COMPARTMENT_ARTIFACT_REGISTRY_READ_PASSWORD: string;
  COMPARTMENT_ARTIFACT_REGISTRY_READ_USERNAME: string;
  COMPARTMENT_BOOTSTRAP_SERVICE_ACCOUNT_NAME: string;
  COMPARTMENT_EDGE_NAMESPACE: string;
  COMPARTMENT_KUBE_POD_CIDR: string;
  COMPARTMENT_KUBE_SERVICE_CIDR: string;
  COMPARTMENT_PLATFORM_NAMESPACE: string;
  COMPARTMENT_PROJECT_ID: string;
  COMPARTMENT_WORKER_SERVICE_ACCOUNT_NAME: string;
}

const environmentSchema: z.ZodTypeAny = z.object({
  COMPARTMENT_ARTIFACT_REGISTRY_HOST: z.string().min(1),
  COMPARTMENT_ARTIFACT_REGISTRY_PORT: z.coerce.number().int().positive(),
  COMPARTMENT_ARTIFACT_REGISTRY_READ_PASSWORD: z.string().min(1),
  COMPARTMENT_ARTIFACT_REGISTRY_READ_USERNAME: z.string().min(1),
  COMPARTMENT_BOOTSTRAP_SERVICE_ACCOUNT_NAME: z.string().min(1),
  COMPARTMENT_EDGE_NAMESPACE: z.string().min(1),
  COMPARTMENT_KUBE_POD_CIDR: z.string().min(1),
  COMPARTMENT_KUBE_SERVICE_CIDR: z.string().min(1),
  COMPARTMENT_PLATFORM_NAMESPACE: z.string().min(1),
  COMPARTMENT_PROJECT_ID: z.string().min(1),
  COMPARTMENT_WORKER_SERVICE_ACCOUNT_NAME: z.string().min(1),
});

async function main(): Promise<void> {
  const environment: ProjectProvisionerJobEnvironment = environmentSchema.parse(
    process.env,
  ) as ProjectProvisionerJobEnvironment;
  await createSelfCleaningKubeRuntimeFromEnvironment().apply(projectProvisioningBundle(environment));
}

function projectProvisioningBundle(environment: ProjectProvisionerJobEnvironment): ApplyBundle {
  return projectNamespaceProvisioningBundle(projectProvisioningRow(environment));
}

function projectProvisioningRow(environment: ProjectProvisionerJobEnvironment): ProjectNamespaceProvisioningRow {
  return {
    bootstrapServiceAccount: {
      name: environment.COMPARTMENT_BOOTSTRAP_SERVICE_ACCOUNT_NAME,
      namespace: environment.COMPARTMENT_PLATFORM_NAMESPACE,
    },
    namespaceId: environment.COMPARTMENT_PROJECT_ID,
    networkPolicy: projectNetworkPolicy(environment),
    projectId: environment.COMPARTMENT_PROJECT_ID,
    registryPullCredentials: {
      dockerConfigJson: registryDockerConfig(environment),
      secretId: environment.COMPARTMENT_PROJECT_ID,
    },
    workerServiceAccount: {
      name: environment.COMPARTMENT_WORKER_SERVICE_ACCOUNT_NAME,
      namespace: environment.COMPARTMENT_PLATFORM_NAMESPACE,
    },
  };
}

function projectNetworkPolicy(environment: ProjectProvisionerJobEnvironment): ProjectNetworkPolicyProjection {
  return {
    applicationPodLabels: { app: 'application' },
    applicationPort: 3000,
    edgeNamespaceName: environment.COMPARTMENT_EDGE_NAMESPACE,
    edgePodLabels: { 'app.kubernetes.io/component': 'edge' },
    podCidr: environment.COMPARTMENT_KUBE_POD_CIDR,
    resourcePodLabels: { app: 'resource' },
    resourcePort: 5432,
    serviceCidr: environment.COMPARTMENT_KUBE_SERVICE_CIDR,
  };
}

function registryDockerConfig(environment: ProjectProvisionerJobEnvironment): string {
  const authority: string = `${environment.COMPARTMENT_ARTIFACT_REGISTRY_HOST}:${environment.COMPARTMENT_ARTIFACT_REGISTRY_PORT}`;
  const auth: string = Buffer.from(
    `${environment.COMPARTMENT_ARTIFACT_REGISTRY_READ_USERNAME}:${environment.COMPARTMENT_ARTIFACT_REGISTRY_READ_PASSWORD}`,
  ).toString('base64');
  return JSON.stringify({ auths: { [authority]: { auth } } });
}

void main();
