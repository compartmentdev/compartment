import { z } from 'zod';

/**
 * One endpoint as the in-Pod reachability probe reads it, carried into the probe container as a serialized
 * environment value.
 *
 * This is worker-internal, not a wire contract: the worker writes it into a container it projects, and the same
 * worker image reads it back in `await-resources-job.ts`. It mirrors how `COMPARTMENT_BUILD_JOB_INPUT` reaches
 * `build-job.js`. The control plane never sees it, and never resolves a Kubernetes DNS name.
 */
export interface ResourceReachabilityTarget {
  host: string;
  port: number;
  timeoutMs: number;
}

export const resourceReachabilityTargetsEnvironmentName: string = 'COMPARTMENT_RESOURCE_REACHABILITY_TARGETS';

export const resourceReachabilityTargetsSchema: z.ZodType<ResourceReachabilityTarget[]> = z.array(
  z
    .object({
      host: z.string().min(1),
      port: z.number().int().min(1).max(65_535),
      timeoutMs: z.number().int().positive(),
    })
    .strict(),
);
