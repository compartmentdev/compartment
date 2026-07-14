import { z } from 'zod';
import { readWorkerConfig, type WorkerConfig } from './config';
import {
  projectProvisioningEnvironmentSchema,
  type ProjectProvisioningEnvironment,
} from './project-provisioning-environment';
import type { ProjectProvisionerConfig } from './project-provisioner.types';

interface ProjectProvisionerEnvironment extends ProjectProvisioningEnvironment {
  COMPARTMENT_PROJECT_PROVISIONER_IMAGE: string;
}

const projectProvisionerEnvironmentSchema: z.ZodType<ProjectProvisionerEnvironment> =
  projectProvisioningEnvironmentSchema.and(
    z.object({
      COMPARTMENT_PROJECT_PROVISIONER_IMAGE: z.string().min(1),
    }),
  );

export function readProjectProvisionerConfig(env: NodeJS.ProcessEnv = process.env): ProjectProvisionerConfig {
  const worker: WorkerConfig = readWorkerConfig(env);
  const parsed: ProjectProvisionerEnvironment = projectProvisionerEnvironmentSchema.parse(env);
  return {
    apiUrl: worker.apiUrl,
    artifactRegistry: worker.artifactRegistry,
    edgeNamespace: parsed.COMPARTMENT_EDGE_NAMESPACE,
    image: parsed.COMPARTMENT_PROJECT_PROVISIONER_IMAGE,
    logLevel: worker.logLevel,
    platformNamespace: parsed.COMPARTMENT_PLATFORM_NAMESPACE,
    provisioningNamespace: parsed.COMPARTMENT_PROVISIONING_NAMESPACE,
    podCidr: parsed.COMPARTMENT_KUBE_POD_CIDR,
    pollIntervalMs: worker.pollIntervalMs,
    runtimeControlToken: worker.runtimeControlToken,
    serviceCidr: parsed.COMPARTMENT_KUBE_SERVICE_CIDR,
    workerServiceAccountName: parsed.COMPARTMENT_WORKER_SERVICE_ACCOUNT_NAME,
  };
}
