import type { z } from 'zod';

/**
 * The endpoint's Zod shape, so a schema that adds fields to it composes from one definition rather than restating
 * the field rules. Spread it into the object literal `z.object` receives: an interface carries no index signature
 * of its own, and giving it one would widen every schema built from it back to `unknown` per field.
 */
export interface ResourceReachabilityEndpointShape {
  port: z.ZodNumber;
  resourceId: z.ZodString;
  timeoutMs: z.ZodNumber;
}
