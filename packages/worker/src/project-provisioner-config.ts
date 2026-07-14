import { z } from 'zod';
import { readWorkerConfig, type WorkerConfig } from './config';
import type { ProjectProvisionerConfig } from './project-provisioner.types';

interface ProjectProvisionerEnvironment {
  COMPARTMENT_BOOTSTRAP_SERVICE_ACCOUNT_NAME: string;
  COMPARTMENT_EDGE_NAMESPACE: string;
  COMPARTMENT_KUBE_POD_CIDR: string;
  COMPARTMENT_KUBE_SERVICE_CIDR: string;
  COMPARTMENT_PLATFORM_NAMESPACE: string;
  COMPARTMENT_PROJECT_PROVISIONER_IMAGE: string;
  COMPARTMENT_WORKER_SERVICE_ACCOUNT_NAME: string;
}

const projectProvisionerEnvironmentSchema: z.ZodTypeAny = z.object({
  COMPARTMENT_BOOTSTRAP_SERVICE_ACCOUNT_NAME: z.string().min(1),
  COMPARTMENT_EDGE_NAMESPACE: z.string().min(1),
  COMPARTMENT_KUBE_POD_CIDR: z.string().min(1),
  COMPARTMENT_KUBE_SERVICE_CIDR: z.string().min(1),
  COMPARTMENT_PLATFORM_NAMESPACE: z.string().min(1),
  COMPARTMENT_PROJECT_PROVISIONER_IMAGE: z.string().min(1),
  COMPARTMENT_WORKER_SERVICE_ACCOUNT_NAME: z.string().min(1),
});

export function readProjectProvisionerConfig(env: NodeJS.ProcessEnv = process.env): ProjectProvisionerConfig {
  const worker: WorkerConfig = readWorkerConfig(env);
  const parsed: ProjectProvisionerEnvironment = projectProvisionerEnvironmentSchema.parse(
    env,
  ) as ProjectProvisionerEnvironment;
  return {
    apiUrl: worker.apiUrl,
    artifactRegistry: worker.artifactRegistry,
    bootstrapServiceAccountName: parsed.COMPARTMENT_BOOTSTRAP_SERVICE_ACCOUNT_NAME,
    edgeNamespace: parsed.COMPARTMENT_EDGE_NAMESPACE,
    image: parsed.COMPARTMENT_PROJECT_PROVISIONER_IMAGE,
    logLevel: worker.logLevel,
    platformNamespace: parsed.COMPARTMENT_PLATFORM_NAMESPACE,
    podCidr: parsed.COMPARTMENT_KUBE_POD_CIDR,
    pollIntervalMs: worker.pollIntervalMs,
    runtimeControlToken: worker.runtimeControlToken,
    serviceCidr: parsed.COMPARTMENT_KUBE_SERVICE_CIDR,
    workerServiceAccountName: parsed.COMPARTMENT_WORKER_SERVICE_ACCOUNT_NAME,
  };
}
