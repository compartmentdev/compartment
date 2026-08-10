import { z } from 'zod';
import type { ContractSchema } from './schema.types';

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

/**
 * One endpoint as the in-Pod reachability probe reads it, carried into the probe container as a serialized
 * environment value. The host is a Kubernetes DNS name, so it is resolved by the runtime layer that owns naming.
 */
export interface ResourceReachabilityTarget {
  host: string;
  port: number;
  timeoutMs: number;
}

/**
 * Environment variable carrying the probe's targets. It crosses a process boundary: the projection writes it and a
 * separate container process reads it back.
 */
export const resourceReachabilityTargetsEnvironmentName: string = 'COMPARTMENT_RESOURCE_REACHABILITY_TARGETS';

export function createResourceReachabilityEndpointShape(): {
  port: z.ZodNumber;
  resourceId: z.ZodString;
  timeoutMs: z.ZodNumber;
} {
  return {
    port: z.number().int().min(1).max(65_535),
    resourceId: z.string().min(1),
    timeoutMs: z.number().int().positive(),
  };
}

export const resourceReachabilityEndpointSchema: ContractSchema<ResourceReachabilityEndpoint> = z
  .object(createResourceReachabilityEndpointShape())
  .strict();

export const resourceReachabilityTargetsSchema: ContractSchema<ResourceReachabilityTarget[]> = z.array(
  z
    .object({
      host: z.string().min(1),
      port: z.number().int().min(1).max(65_535),
      timeoutMs: z.number().int().positive(),
    })
    .strict(),
);
