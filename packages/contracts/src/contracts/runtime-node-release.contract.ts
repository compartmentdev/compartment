import { z } from 'zod';
import { compartmentProjectNameSchema, compartmentServiceNameSchema } from './compartment-descriptor.contract';
import { environmentNameSchema } from './environments.contract';
import {
  resolvedCompartmentServiceReleaseConfigSchema,
  type ResolvedCompartmentServiceReleaseConfig,
} from './service-release.contract';
import { runtimeNetworkIntentSchema, type RuntimeNetworkIntent } from './runtime-node-network.contract';
import type { ContractSchema } from './schema.types';

export interface NodeReleaseRequest {
  deploymentId: string;
  environmentId: string;
  environmentName: string;
  imageRef: string;
  projectId: string;
  projectName: string;
  release: ResolvedCompartmentServiceReleaseConfig;
  runtimeNetwork: RuntimeNetworkIntent;
  runtimeEnv: Record<string, string>;
  serviceId: string;
  serviceName: string;
}

export interface NodeReleaseResponse {
  completedAt: string;
  logs: NodeReleaseLogLine[];
  stderr: string;
  stdout: string;
}

export interface NodeReleaseLogLine {
  message: string;
  stream: 'stderr' | 'stdout';
}

export const nodeReleasePathname: string = '/internal/deployments/release';

export const nodeReleaseRequestSchema: ContractSchema<NodeReleaseRequest> = z
  .object({
    deploymentId: z.string().min(1),
    environmentId: z.string().min(1),
    environmentName: environmentNameSchema,
    imageRef: z.string().min(1),
    projectId: z.string().min(1),
    projectName: compartmentProjectNameSchema,
    release: resolvedCompartmentServiceReleaseConfigSchema,
    runtimeNetwork: runtimeNetworkIntentSchema,
    runtimeEnv: z.record(z.string(), z.string()),
    serviceId: z.string().min(1),
    serviceName: compartmentServiceNameSchema,
  })
  .strict();

export const nodeReleaseResponseSchema: ContractSchema<NodeReleaseResponse> = z
  .object({
    completedAt: z.string().datetime(),
    logs: z.array(
      z
        .object({
          message: z.string(),
          stream: z.enum(['stderr', 'stdout']),
        })
        .strict(),
    ),
    stderr: z.string(),
    stdout: z.string(),
  })
  .strict();
