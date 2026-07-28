import { Buffer } from 'node:buffer';
import { z } from 'zod';
import type { ProjectProvisioningTargetV2 } from '@compartment/contracts';
import type { ProjectProvisionerConfig } from './project-provisioner.types';
import { issueProjectPullCredential } from './registry-credentials';
import type { RegistryCredential } from './registry-credentials.types';

export interface ProjectProvisioningEnvironment {
  COMPARTMENT_EDGE_NAMESPACE: string;
  COMPARTMENT_KUBE_POD_CIDR: string;
  COMPARTMENT_KUBE_SERVICE_CIDR: string;
  COMPARTMENT_PLATFORM_NAMESPACE: string;
  COMPARTMENT_PROVISIONING_NAMESPACE: string;
  COMPARTMENT_WORKER_SERVICE_ACCOUNT_NAME: string;
}

export const projectProvisioningEnvironmentSchema: z.ZodType<ProjectProvisioningEnvironment> = z.object({
  COMPARTMENT_EDGE_NAMESPACE: z.string().min(1),
  COMPARTMENT_KUBE_POD_CIDR: z.string().min(1),
  COMPARTMENT_KUBE_SERVICE_CIDR: z.string().min(1),
  COMPARTMENT_PLATFORM_NAMESPACE: z.string().min(1),
  COMPARTMENT_PROVISIONING_NAMESPACE: z.string().min(1),
  COMPARTMENT_WORKER_SERVICE_ACCOUNT_NAME: z.string().min(1),
});

export interface ProjectProvisionerJobEnvironment extends ProjectProvisioningEnvironment {
  COMPARTMENT_ARTIFACT_REGISTRY_HOST: string;
  COMPARTMENT_ARTIFACT_REGISTRY_PORT: string;
  COMPARTMENT_ARTIFACT_REGISTRY_PULL_DOCKER_CONFIG_JSON: string;
  COMPARTMENT_BOOTSTRAP_SERVICE_ACCOUNT_NAME: string;
  COMPARTMENT_PROJECT_ID: string;
}

export const projectProvisionerJobEnvironmentSchema: z.ZodType<ProjectProvisionerJobEnvironment> =
  projectProvisioningEnvironmentSchema.and(
    z.object({
      COMPARTMENT_ARTIFACT_REGISTRY_HOST: z.string().min(1),
      COMPARTMENT_ARTIFACT_REGISTRY_PORT: z.string().regex(/^[1-9]\d*$/u),
      COMPARTMENT_ARTIFACT_REGISTRY_PULL_DOCKER_CONFIG_JSON: z.string().min(1),
      COMPARTMENT_BOOTSTRAP_SERVICE_ACCOUNT_NAME: z.string().min(1),
      COMPARTMENT_PROJECT_ID: z.string().min(1),
    }),
  );

export function projectProvisionerJobEnvironment(
  config: ProjectProvisionerConfig,
  target: ProjectProvisioningTargetV2,
  bootstrapServiceAccountName: string,
): ProjectProvisionerJobEnvironment {
  const registryUrl: URL = new URL(`http://${config.artifactRegistry.address}`);
  const pullCredential: RegistryCredential = issueProjectPullCredential(
    config.artifactRegistry.credentialSigningKey,
    target.projectId,
  );
  return {
    COMPARTMENT_ARTIFACT_REGISTRY_HOST: registryUrl.hostname,
    COMPARTMENT_ARTIFACT_REGISTRY_PORT: registryUrl.port,
    COMPARTMENT_ARTIFACT_REGISTRY_PULL_DOCKER_CONFIG_JSON: buildDockerConfig(registryUrl, pullCredential),
    COMPARTMENT_BOOTSTRAP_SERVICE_ACCOUNT_NAME: bootstrapServiceAccountName,
    COMPARTMENT_EDGE_NAMESPACE: config.edgeNamespace,
    COMPARTMENT_KUBE_POD_CIDR: config.podCidr,
    COMPARTMENT_KUBE_SERVICE_CIDR: config.serviceCidr,
    COMPARTMENT_PLATFORM_NAMESPACE: config.platformNamespace,
    COMPARTMENT_PROJECT_ID: target.projectId,
    COMPARTMENT_PROVISIONING_NAMESPACE: config.provisioningNamespace,
    COMPARTMENT_WORKER_SERVICE_ACCOUNT_NAME: config.workerServiceAccountName,
  };
}

function buildDockerConfig(registryUrl: URL, credential: RegistryCredential): string {
  const authority: string = `${registryUrl.hostname}:${registryUrl.port}`;
  const auth: string = Buffer.from(`${credential.username}:${credential.password}`).toString('base64');
  return JSON.stringify({
    auths: {
      [authority]: { auth, password: credential.password, username: credential.username },
    },
  });
}
