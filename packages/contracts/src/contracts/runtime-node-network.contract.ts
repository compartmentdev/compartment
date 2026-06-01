import { z } from 'zod';
import type { ContractSchema } from './schema.types';

export interface NodeRuntimeNetworkReconcileResponse {
  success: true;
}
export interface RuntimeNetworkIntent {
  requiresResourceNetwork: boolean;
}

export interface NodeRuntimeNetworkReservationRequest extends RuntimeNetworkIntent {
  deploymentId: string;
  environmentId: string;
  projectId: string;
  serviceId: string;
  serviceNetworkEndpointReservations: number;
}

export interface NodeRuntimeNetworkReservationResponse {
  expiresAt: string;
  newlyCreatedNetworkNames: string[];
  reservationId: string;
  reservedNetworkNames: string[];
}

export interface NodeRuntimeNetworkReservationCleanupRequest {
  networkNames: string[];
  reservationId: string;
}

export interface NodeRuntimeNetworkReservationCleanupResponse {
  cleanedAt: string;
}

export type NodeRuntimeNetworkErrorCode = 'runtime_docker_error' | 'runtime_network_capacity_exhausted';

export const nodeRuntimeDockerErrorCode: NodeRuntimeNetworkErrorCode = 'runtime_docker_error';
export const nodeRuntimeNetworkCapacityExhaustedErrorCode: NodeRuntimeNetworkErrorCode =
  'runtime_network_capacity_exhausted';

export const nodeRuntimeNetworkReservationPathname: string = '/internal/runtime-networks/reserve';
export const nodeRuntimeNetworkReservationCleanupPathname: string = '/internal/runtime-networks/reservations/cleanup';
export const nodeRuntimeNetworkReconcilePathname: string = '/internal/runtime-networks/reconcile';

export const runtimeNetworkIntentSchema: ContractSchema<RuntimeNetworkIntent> = z
  .object({
    requiresResourceNetwork: z.boolean(),
  })
  .strict();

export const nodeRuntimeNetworkReservationRequestSchema: ContractSchema<NodeRuntimeNetworkReservationRequest> = z
  .object({
    deploymentId: z.string().min(1),
    environmentId: z.string().min(1),
    projectId: z.string().min(1),
    requiresResourceNetwork: z.boolean(),
    serviceId: z.string().min(1),
    serviceNetworkEndpointReservations: z.number().int().min(1).max(2),
  })
  .strict();

export const nodeRuntimeNetworkReservationResponseSchema: ContractSchema<NodeRuntimeNetworkReservationResponse> = z
  .object({
    expiresAt: z.string().datetime(),
    newlyCreatedNetworkNames: z.array(z.string().min(1)),
    reservationId: z.string().min(1),
    reservedNetworkNames: z.array(z.string().min(1)),
  })
  .strict();

export const nodeRuntimeNetworkReservationCleanupRequestSchema: ContractSchema<NodeRuntimeNetworkReservationCleanupRequest> =
  z
    .object({
      networkNames: z.array(z.string().min(1)),
      reservationId: z.string().min(1),
    })
    .strict();

export const nodeRuntimeNetworkReservationCleanupResponseSchema: ContractSchema<NodeRuntimeNetworkReservationCleanupResponse> =
  z
    .object({
      cleanedAt: z.string().datetime(),
    })
    .strict();

export const nodeRuntimeNetworkReconcileResponseSchema: ContractSchema<NodeRuntimeNetworkReconcileResponse> = z
  .object({
    success: z.literal(true),
  })
  .strict();
