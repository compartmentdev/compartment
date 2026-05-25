import { z } from 'zod';
import type { ContractSchema } from './schema.types';

export interface NodeRegistrationRequest {
  nodeSocketPath: string;
  nodeName: string;
  nodeVersion: string;
}

export interface NodeSummary {
  id: string;
  name: string;
  nodeVersion: string;
  nodeSocketPath: string;
}

export interface NodeRegistrationResponse {
  node: NodeSummary;
  registeredAt: string;
}

export const compartmentInternalNodeRegistrationPathname: string = '/internal/nodes/register';

const nodeSummarySchema: ContractSchema<NodeSummary> = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    nodeVersion: z.string().min(1),
    nodeSocketPath: z.string().min(1),
  })
  .strict();

export const nodeRegistrationRequestSchema: ContractSchema<NodeRegistrationRequest> = z
  .object({
    nodeSocketPath: z.string().min(1),
    nodeName: z.string().min(1),
    nodeVersion: z.string().min(1),
  })
  .strict();

export const nodeRegistrationResponseSchema: ContractSchema<NodeRegistrationResponse> = z
  .object({
    node: nodeSummarySchema,
    registeredAt: z.string().datetime(),
  })
  .strict();
