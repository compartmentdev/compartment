import { Buffer } from 'node:buffer';
import {
  createSelfCleaningKubeRuntimeFromEnvironment,
  projectNamespaceProvisioningBundle,
  type ApplyBundle,
  type ProjectNamespaceProvisioningRow,
} from '@compartment/kube-runtime';
import {
  projectProvisionerJobEnvironmentSchema,
  type ProjectProvisionerJobEnvironment,
} from './project-provisioning-environment';
import { projectNetworkPolicy } from './project-network-policy';

async function main(): Promise<void> {
  const environment: ProjectProvisionerJobEnvironment = projectProvisionerJobEnvironmentSchema.parse(process.env);
  await createSelfCleaningKubeRuntimeFromEnvironment().apply(projectProvisioningBundle(environment));
}

function projectProvisioningBundle(environment: ProjectProvisionerJobEnvironment): ApplyBundle {
  return projectNamespaceProvisioningBundle(projectProvisioningRow(environment));
}

function projectProvisioningRow(environment: ProjectProvisionerJobEnvironment): ProjectNamespaceProvisioningRow {
  return {
    bootstrapServiceAccount: {
      name: environment.COMPARTMENT_BOOTSTRAP_SERVICE_ACCOUNT_NAME,
      namespace: environment.COMPARTMENT_PROVISIONING_NAMESPACE,
    },
    namespaceId: environment.COMPARTMENT_PROJECT_ID,
    networkPolicy: projectNetworkPolicy(environment, { applicationPorts: [], resourcePorts: [] }),
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

function registryDockerConfig(environment: ProjectProvisionerJobEnvironment): string {
  const authority: string = `${environment.COMPARTMENT_ARTIFACT_REGISTRY_HOST}:${environment.COMPARTMENT_ARTIFACT_REGISTRY_PORT}`;
  const auth: string = Buffer.from(
    `${environment.COMPARTMENT_ARTIFACT_REGISTRY_READ_USERNAME}:${environment.COMPARTMENT_ARTIFACT_REGISTRY_READ_PASSWORD}`,
  ).toString('base64');
  return JSON.stringify({ auths: { [authority]: { auth } } });
}

void main();
