import { z } from 'zod';
import { resourceReadinessSummarySchema, type ResourceReadinessSummary } from './resources.contract';
import type { ContractSchema } from './schema.types';
import { projectNetworkPolicyPortsSchema, type ProjectNetworkPolicyPorts } from './internal-network-policy.contract';

export const resourceReconcileLifecycleTimeoutMs: number = 120_000;

export interface ResourceClaimIdentity {
  claimName: string;
  uid: string;
}

export interface ResourceVolumeIntent {
  mountPath: string;
  size: string;
  volumeHandle: string;
}

export interface ResourceReconcileIntent {
  command: string[];
  deleteData: boolean;
  environmentId: string;
  env: Record<string, string>;
  image: string;
  namespaceId: string;
  operation: 'delete' | 'reconcile';
  ports: number[];
  readiness: ResourceReadinessSummary | null;
  replicas: 0 | 1;
  resourceId: string;
  secretId: string;
  volumes: ResourceVolumeIntent[];
}

export interface WorkerClaimResourceReconcileResponse {
  expectedClaims: ResourceClaimIdentity[];
  intent: ResourceReconcileIntent | null;
  operationId: string | null;
  leaseId: string | null;
  networkPolicy: ProjectNetworkPolicyPorts;
  previousManifestJson: string | null;
  type: 'bootstrap' | 'reconcile' | null;
}

export interface WorkerAcknowledgeResourceReconcileRequest {
  expectedClaims?: ResourceClaimIdentity[] | undefined;
  failureMessage?: string | undefined;
  operationId: string;
  leaseId: string;
  previousManifestJson?: string | undefined;
  status: 'failed' | 'running' | 'succeeded';
}

export const workerClaimResourceReconcilePathname: string = '/internal/kube-resources/claim-next';
export const workerAcknowledgeResourceReconcilePathname: string = '/internal/kube-resources/ack';

const resourceClaimIdentitySchema: ContractSchema<ResourceClaimIdentity> = z
  .object({ claimName: z.string().min(1), uid: z.string().min(1) })
  .strict();
const resourceVolumeIntentSchema: ContractSchema<ResourceVolumeIntent> = z
  .object({ mountPath: z.string().startsWith('/'), size: z.string().min(1), volumeHandle: z.string().min(1) })
  .strict();
const resourceReconcileIntentSchema: ContractSchema<ResourceReconcileIntent> = z
  .object({
    command: z.array(z.string().min(1)),
    deleteData: z.boolean(),
    environmentId: z.string().min(1),
    env: z.record(z.string(), z.string()),
    image: z.string().min(1),
    namespaceId: z.string().min(1),
    operation: z.enum(['delete', 'reconcile']),
    ports: z.array(z.number().int().min(1).max(65_535)),
    readiness: resourceReadinessSummarySchema.nullable(),
    replicas: z.union([z.literal(0), z.literal(1)]),
    resourceId: z.string().min(1),
    secretId: z.string().min(1),
    volumes: z.array(resourceVolumeIntentSchema),
  })
  .strict();
export const workerClaimResourceReconcileResponseSchema: ContractSchema<WorkerClaimResourceReconcileResponse> = z
  .object({
    expectedClaims: z.array(resourceClaimIdentitySchema),
    intent: resourceReconcileIntentSchema.nullable(),
    operationId: z.string().min(1).nullable(),
    leaseId: z.string().min(1).nullable(),
    networkPolicy: projectNetworkPolicyPortsSchema,
    previousManifestJson: z.string().min(1).nullable(),
    type: z.enum(['bootstrap', 'reconcile']).nullable(),
  })
  .strict();
export const workerAcknowledgeResourceReconcileRequestSchema: ContractSchema<WorkerAcknowledgeResourceReconcileRequest> =
  z
    .object({
      expectedClaims: z.array(resourceClaimIdentitySchema).optional(),
      failureMessage: z.string().min(1).optional(),
      operationId: z.string().min(1),
      leaseId: z.string().min(1),
      previousManifestJson: z.string().min(1).optional(),
      status: z.enum(['failed', 'running', 'succeeded']),
    })
    .strict();
