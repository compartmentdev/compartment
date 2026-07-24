import { z } from 'zod';
import type { ContractSchema } from './schema.types';

export interface ProjectNetworkPolicyPorts {
  applicationPorts: number[];
  resourcePorts: number[];
}

const networkPolicyPortSchema: z.ZodNumber = z.number().int().min(1).max(65_535);

export const projectNetworkPolicyPortsSchema: ContractSchema<ProjectNetworkPolicyPorts> = z
  .object({
    applicationPorts: z.array(networkPolicyPortSchema),
    resourcePorts: z.array(networkPolicyPortSchema),
  })
  .strict();
