import { z } from 'zod';

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
