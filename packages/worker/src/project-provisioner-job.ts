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
import { readProjectContainerDefaults, readProjectQuota } from './resource-quota-config';

async function main(): Promise<void> {
  const environment: ProjectProvisionerJobEnvironment = projectProvisionerJobEnvironmentSchema.parse(process.env);
  await createSelfCleaningKubeRuntimeFromEnvironment().apply(projectProvisioningBundle(environment));
}

function projectProvisioningBundle(environment: ProjectProvisionerJobEnvironment): ApplyBundle {
  return projectNamespaceProvisioningBundle(projectProvisioningRow(environment), {
    containerDefaults: readProjectContainerDefaults(
      environment.COMPARTMENT_PROJECT_CONTAINER_DEFAULTS,
      'COMPARTMENT_PROJECT_CONTAINER_DEFAULTS',
    ),
    quota: readProjectQuota(environment.COMPARTMENT_PROJECT_QUOTA, 'COMPARTMENT_PROJECT_QUOTA'),
  });
}

function projectProvisioningRow(environment: ProjectProvisionerJobEnvironment): ProjectNamespaceProvisioningRow {
  return {
    bootstrapServiceAccount: {
      name: environment.COMPARTMENT_BOOTSTRAP_SERVICE_ACCOUNT_NAME,
      namespace: environment.COMPARTMENT_PROVISIONING_NAMESPACE,
    },
    namespaceId: environment.COMPARTMENT_PROJECT_ID,
    networkPolicy: projectNetworkPolicy(environment, { applicationPorts: [], resourcePorts: [] }),
    organizationId: environment.COMPARTMENT_ORGANIZATION_ID,
    projectId: environment.COMPARTMENT_PROJECT_ID,
    projectName: environment.COMPARTMENT_PROJECT_NAME,
    installationId: environment.COMPARTMENT_INSTALLATION_ID,
    registryPullCredentials: {
      dockerConfigJson: environment.COMPARTMENT_ARTIFACT_REGISTRY_PULL_DOCKER_CONFIG_JSON,
      secretId: environment.COMPARTMENT_PROJECT_ID,
    },
    workerServiceAccount: {
      name: environment.COMPARTMENT_WORKER_SERVICE_ACCOUNT_NAME,
      namespace: environment.COMPARTMENT_PLATFORM_NAMESPACE,
    },
  };
}

void main();
