import type {
  KubeLeaderElectionConfig,
  KubeWorkloadScheduling,
  ProjectNamespaceResourceConfiguration,
} from '@compartment/kube-runtime';
import { z } from 'zod';
import { readWorkerProcessConfig, workerLeaderElectionConfig, type WorkerProcessConfig } from './config';
import {
  projectProvisioningEnvironmentSchema,
  type ProjectProvisioningEnvironment,
} from './project-provisioning-environment';
import type { ProjectProvisionerConfig } from './project-provisioner.types';
import { readEdgePodLabels } from './project-network-policy';
import { readTenantWorkloadScheduling } from './tenant-workload-scheduling';
import { readProjectContainerDefaults, readProjectQuota } from './resource-quota-config';

interface ProjectProvisionerEnvironment extends ProjectProvisioningEnvironment {
  COMPARTMENT_KUBE_TENANT_SCHEDULING?: string | undefined;
  COMPARTMENT_PROJECT_PROVISIONER_IMAGE: string;
}

const projectProvisionerEnvironmentSchema: z.ZodType<ProjectProvisionerEnvironment> =
  projectProvisioningEnvironmentSchema.and(
    z.object({
      COMPARTMENT_PROJECT_PROVISIONER_IMAGE: z.string().min(1),
      COMPARTMENT_KUBE_TENANT_SCHEDULING: z.string().min(1).optional(),
    }),
  );

export function readProjectProvisionerConfig(env: NodeJS.ProcessEnv = process.env): ProjectProvisionerConfig {
  const worker: WorkerProcessConfig = readWorkerProcessConfig(env);
  const parsed: ProjectProvisionerEnvironment = projectProvisionerEnvironmentSchema.parse(env);
  const tenantScheduling: KubeWorkloadScheduling | undefined = readProjectTenantScheduling(parsed);
  const leaderElection: KubeLeaderElectionConfig = readProjectLeaderElection(worker, parsed);
  const resourceConfiguration: ProjectNamespaceResourceConfiguration = {
    containerDefaults: readProjectContainerDefaults(
      parsed.COMPARTMENT_PROJECT_CONTAINER_DEFAULTS,
      'COMPARTMENT_PROJECT_CONTAINER_DEFAULTS',
    ),
    quota: readProjectQuota(parsed.COMPARTMENT_PROJECT_QUOTA, 'COMPARTMENT_PROJECT_QUOTA'),
  };
  return {
    apiUrl: worker.apiUrl,
    artifactRegistry: worker.artifactRegistry,
    edgeNamespace: parsed.COMPARTMENT_EDGE_NAMESPACE,
    edgePodLabels: readEdgePodLabels(parsed.COMPARTMENT_EDGE_POD_LABELS),
    image: parsed.COMPARTMENT_PROJECT_PROVISIONER_IMAGE,
    installationId: parsed.COMPARTMENT_INSTALLATION_ID,
    leaderElection,
    logLevel: worker.logLevel,
    platformNamespace: parsed.COMPARTMENT_PLATFORM_NAMESPACE,
    provisioningNamespace: parsed.COMPARTMENT_PROVISIONING_NAMESPACE,
    resourceConfiguration,
    podCidr: parsed.COMPARTMENT_KUBE_POD_CIDR,
    pollIntervalMs: worker.pollIntervalMs,
    runtimeControlToken: worker.runtimeControlToken,
    serviceCidr: parsed.COMPARTMENT_KUBE_SERVICE_CIDR,
    ...(tenantScheduling === undefined ? {} : { tenantScheduling }),
    workerServiceAccountName: parsed.COMPARTMENT_WORKER_SERVICE_ACCOUNT_NAME,
  };
}

function readProjectTenantScheduling(parsed: ProjectProvisionerEnvironment): KubeWorkloadScheduling | undefined {
  return readTenantWorkloadScheduling(parsed.COMPARTMENT_KUBE_TENANT_SCHEDULING);
}

function readProjectLeaderElection(
  worker: WorkerProcessConfig,
  parsed: ProjectProvisionerEnvironment,
): KubeLeaderElectionConfig {
  return workerLeaderElectionConfig(worker, 'compartment-project-provisioner', parsed.COMPARTMENT_PLATFORM_NAMESPACE);
}
