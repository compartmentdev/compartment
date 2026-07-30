import {
  managedDomainAllocationsPathname,
  managedDomainChallengesPathname,
  managedDomainDns01ChallengeResponseSchema,
  managedDomainReplayPathname,
  managedDomainReplayResponseSchema,
  managedDomainReservationResponseSchema,
  managedDomainTargetBindingResponseSchema,
  managedDomainTargetsPathname,
  type ManagedDomainDns01ChallengeRequest,
  type ManagedDomainDns01ChallengeResponse,
  type ManagedDomainReplayResponse,
  type ManagedDomainReservationRequest,
  type ManagedDomainReservationResponse,
  type ManagedDomainTargetBindingRequest,
  type ManagedDomainTargetBindingResponse,
} from '@compartment/contracts';
import { z } from 'zod';
import type { CompartmentRequester } from '../http/request.types';

export async function reserveManagedDomain(
  request: CompartmentRequester,
  reservationToken: string | undefined,
  body: ManagedDomainReservationRequest,
): Promise<ManagedDomainReservationResponse> {
  return await request<ManagedDomainReservationResponse, ManagedDomainReservationRequest>({
    body,
    idempotencyKey: body.installationId,
    method: 'POST',
    path: managedDomainAllocationsPathname,
    schema: managedDomainReservationResponseSchema,
    sessionToken: reservationToken ?? '',
  });
}

export async function bindManagedDomainTargets(
  request: CompartmentRequester,
  allocationId: string,
  scopedToken: string,
  body: ManagedDomainTargetBindingRequest,
): Promise<ManagedDomainTargetBindingResponse> {
  return await request<ManagedDomainTargetBindingResponse, ManagedDomainTargetBindingRequest>({
    body,
    method: 'PUT',
    path: managedDomainTargetsPathname(allocationId),
    schema: managedDomainTargetBindingResponseSchema,
    sessionToken: scopedToken,
  });
}

export async function presentManagedDomainDns01Challenge(
  request: CompartmentRequester,
  allocationId: string,
  scopedToken: string,
  body: ManagedDomainDns01ChallengeRequest,
): Promise<void> {
  await request<ManagedDomainDns01ChallengeResponse, ManagedDomainDns01ChallengeRequest>({
    body,
    method: 'POST',
    path: managedDomainChallengesPathname(allocationId),
    schema: managedDomainDns01ChallengeResponseSchema,
    sessionToken: scopedToken,
  });
}

export async function cleanUpManagedDomainDns01Challenge(
  request: CompartmentRequester,
  allocationId: string,
  scopedToken: string,
  body: ManagedDomainDns01ChallengeRequest,
): Promise<void> {
  await request<null, ManagedDomainDns01ChallengeRequest>({
    body,
    method: 'DELETE',
    path: managedDomainChallengesPathname(allocationId),
    schema: z.null(),
    sessionToken: scopedToken,
  });
}

export async function replayManagedDomainDesiredState(
  request: CompartmentRequester,
  allocationId: string,
  scopedToken: string,
): Promise<ManagedDomainReplayResponse> {
  return await request<ManagedDomainReplayResponse, never>({
    method: 'POST',
    path: managedDomainReplayPathname(allocationId),
    schema: managedDomainReplayResponseSchema,
    sessionToken: scopedToken,
  });
}
