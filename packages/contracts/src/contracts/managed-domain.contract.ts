import { z } from 'zod';
import type { ContractSchema } from './schema.types';

export const managedDomainRequestedLabelSourceMaxLength: number = 128;
export const managedDomainAllocationsPathname: string = '/v1/managed-domains/allocations';

export interface ManagedDomainReservationRequest {
  /** Stable idempotency key, also sent as Idempotency-Key. Brokers must return its existing allocation on retry. */
  installationId: string;
  metadata?: ManagedDomainAllocationMetadata | undefined;
  requestedLabelSource: string;
}

export interface ManagedDomainAllocationMetadata {
  cliVersion: string;
  os: ManagedDomainAllocationOsMetadata;
  runtimeVersion: string;
}

export interface ManagedDomainAllocationOsMetadata {
  arch: string;
  platform: string;
  release: string;
}

export interface ManagedDomainReservationResponse {
  allocationId: string;
  baseDomain: string;
  scopedToken: string;
}

export type ManagedDomainTarget = ManagedDomainIpv4Target | ManagedDomainIpv6Target | ManagedDomainHostnameTarget;

export interface ManagedDomainIpv4Target {
  type: 'A';
  value: string;
}

export interface ManagedDomainIpv6Target {
  type: 'AAAA';
  value: string;
}

export interface ManagedDomainHostnameTarget {
  type: 'hostname';
  value: string;
}

export interface ManagedDomainTargetBindingRequest {
  targets: ManagedDomainTarget[];
}

export interface ManagedDomainTargetBindingResponse {
  allocationId: string;
  targets: ManagedDomainTarget[];
}

export interface ManagedDomainDns01ChallengeRequest {
  name: string;
  value: string;
}

export type ManagedDomainDns01ChallengeResponse = ManagedDomainDns01ChallengeRequest;

export interface ManagedDomainReplayResponse {
  allocationId: string;
  challengeCount: number;
  targetCount: number;
}

export const managedDomainTargetSchema: ContractSchema<ManagedDomainTarget> = z.discriminatedUnion('type', [
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

export const managedDomainReservationRequestSchema: ContractSchema<ManagedDomainReservationRequest> = z
  .object({
    installationId: z.string().min(1),
    metadata: z
      .object({
        cliVersion: z.string().min(1),
        os: z
          .object({
            arch: z.string().min(1),
            platform: z.string().min(1),
            release: z.string().min(1),
          })
          .strict(),
        runtimeVersion: z.string().min(1),
      })
      .strict()
      .optional(),
    requestedLabelSource: z.string().min(1).max(managedDomainRequestedLabelSourceMaxLength),
  })
  .strict();

export const managedDomainReservationResponseSchema: ContractSchema<ManagedDomainReservationResponse> = z
  .object({
    allocationId: z.string().min(1),
    baseDomain: z.string().min(1),
    scopedToken: z.string().min(1),
  })
  .strip();

export const managedDomainTargetBindingResponseSchema: ContractSchema<ManagedDomainTargetBindingResponse> = z
  .object({
    allocationId: z.string().min(1),
    targets: z.array(managedDomainTargetSchema).min(1),
  })
  .strip();

export const managedDomainTargetBindingRequestSchema: ContractSchema<ManagedDomainTargetBindingRequest> = z
  .object({
    targets: z.array(managedDomainTargetSchema).min(1),
  })
  .strict();

export const managedDomainDns01ChallengeRequestSchema: ContractSchema<ManagedDomainDns01ChallengeRequest> = z
  .object({
    name: z.string().min(1),
    value: z.string().min(1),
  })
  .strict();

export const managedDomainDns01ChallengeResponseSchema: ContractSchema<ManagedDomainDns01ChallengeResponse> = z
  .object({
    name: z.string().min(1),
    value: z.string().min(1),
  })
  .strip();

export const managedDomainReplayResponseSchema: ContractSchema<ManagedDomainReplayResponse> = z
  .object({
    allocationId: z.string().min(1),
    challengeCount: z.number().int().nonnegative(),
    targetCount: z.number().int().nonnegative(),
  })
  .strip();

export function managedDomainTargetsPathname(allocationId: string): string {
  return `${managedDomainAllocationsPathname}/${encodeURIComponent(allocationId)}/targets`;
}

export function managedDomainChallengesPathname(allocationId: string): string {
  return `${managedDomainAllocationsPathname}/${encodeURIComponent(allocationId)}/challenges`;
}

export function managedDomainReplayPathname(allocationId: string): string {
  return `${managedDomainAllocationsPathname}/${encodeURIComponent(allocationId)}/replay`;
}
