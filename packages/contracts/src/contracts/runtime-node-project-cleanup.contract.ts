import { z } from 'zod';
import { compartmentProjectNameSchema, compartmentServiceNameSchema } from './compartment-descriptor.contract';
import { environmentNameSchema } from './environments.contract';
import { type NodeResourceVolume, nodeResourceVolumeSchema } from './runtime-node-resource.contract';
import type { ContractSchema } from './schema.types';

export interface NodeProjectCleanupResource {
  environmentName: string;
  resourceName: string;
  volumes: NodeResourceVolume[];
}

export type NodeProjectCleanupCaddyNetworkMode = 'disconnect-stale' | 'preserve-stale';

export interface NodeProjectCleanupRequest {
  caddyNetworkMode: NodeProjectCleanupCaddyNetworkMode;
  deleteData: boolean;
  projectId: string;
  projectName: string;
  resources: NodeProjectCleanupResource[];
}

export interface NodeProjectCleanupResponse {
  cleanedAt: string;
}

export const nodeProjectCleanupPathname: string = '/internal/projects/cleanup';

const nodeProjectCleanupResourceSchema: ContractSchema<NodeProjectCleanupResource> = z
  .object({
    environmentName: environmentNameSchema,
    resourceName: compartmentServiceNameSchema,
    volumes: z.array(nodeResourceVolumeSchema),
  })
  .strict();

export const nodeProjectCleanupRequestSchema: ContractSchema<NodeProjectCleanupRequest> = z
  .object({
    caddyNetworkMode: z.union([z.literal('disconnect-stale'), z.literal('preserve-stale')]),
    deleteData: z.boolean(),
    projectId: z.string().min(1),
    projectName: compartmentProjectNameSchema,
    resources: z.array(nodeProjectCleanupResourceSchema),
  })
  .strict();

export const nodeProjectCleanupResponseSchema: ContractSchema<NodeProjectCleanupResponse> = z
  .object({
    cleanedAt: z.string().datetime(),
  })
  .strict();
