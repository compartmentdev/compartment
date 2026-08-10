import { z } from 'zod';
import type { ContractSchema } from './schema.types';
import type { ResourceReachabilityEndpointShape } from './internal-resource-reachability.contract.types';

/**
 * A declared resource endpoint that a workload dials, with the budget the resource has to accept a connection.
 *
 * The control plane resolves these from resource rows, so it names the resource by id and never by Kubernetes DNS.
 * `timeoutMs` is the resource's own declared readiness timeout and is measured from the dialing Pod's start, not
 * from any control-plane instant: a Pod created long after the decision that produced this record still gets the
 * whole declared budget.
 */
export interface ResourceReachabilityEndpoint {
  port: number;
  resourceId: string;
  timeoutMs: number;
}

export function createResourceReachabilityEndpointShape(): ResourceReachabilityEndpointShape {
  return {
    port: z.number().int().min(1).max(65_535),
    resourceId: z.string().min(1),
    timeoutMs: z.number().int().positive(),
  };
}

export const resourceReachabilityEndpointSchema: ContractSchema<ResourceReachabilityEndpoint> = z
  .object({ ...createResourceReachabilityEndpointShape() })
  .strict();
