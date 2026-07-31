import { z } from 'zod';
import type { ContractSchema } from './schema.types';

export type PublicIngressTarget = PublicIngressIpv4Target | PublicIngressIpv6Target | PublicIngressHostnameTarget;

export interface PublicIngressIpv4Target {
  type: 'A';
  value: string;
}

export interface PublicIngressIpv6Target {
  type: 'AAAA';
  value: string;
}

export interface PublicIngressHostnameTarget {
  type: 'hostname';
  value: string;
}

export const publicIngressTargetSchema: ContractSchema<PublicIngressTarget> = z.discriminatedUnion('type', [
  z.object({ type: z.literal('A'), value: z.string().ip({ version: 'v4' }) }).strict(),
  z.object({ type: z.literal('AAAA'), value: z.string().ip({ version: 'v6' }) }).strict(),
  z
    .object({
      type: z.literal('hostname'),
      value: z
        .string()
        .min(1)
        .max(253)
        .regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u)
        .refine((value: string): boolean => !/^[\d.:]+$/u.test(value), 'Hostname targets must remain hostnames.'),
    })
    .strict(),
]);
