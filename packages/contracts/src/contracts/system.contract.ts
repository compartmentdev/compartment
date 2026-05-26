import { z } from 'zod';
import {
  selfHostedImageSourceSchema,
  selfHostedRuntimeImageRegistrySchema,
  type SelfHostedImageSource,
  type SelfHostedRuntimeImageRegistry,
} from './self-hosted.contract';
import {
  rollbackRetentionEffectivePolicySchema,
  type RollbackRetentionEffectivePolicy,
} from './rollback-retention.contract';
import type { ContractSchema } from './schema.types';

export type SystemOverallStatus = 'running' | 'degraded' | 'stopped';
export type SystemServiceHealth = 'healthy' | 'starting' | 'unhealthy';
export type SystemServiceName =
  | 'api'
  | 'registry'
  | 'registry-auth'
  | 'edge'
  | 'node'
  | 'builder'
  | 'worker'
  | 'caddy'
  | 'postgres';
export type SystemServiceStatus =
  | 'running'
  | 'restarting'
  | 'created'
  | 'paused'
  | 'removing'
  | 'exited'
  | 'dead'
  | 'missing'
  | 'unknown';

const systemOverallStatusValues: readonly [SystemOverallStatus, SystemOverallStatus, SystemOverallStatus] = [
  'running',
  'degraded',
  'stopped',
];
const systemServiceHealthValues: readonly [SystemServiceHealth, SystemServiceHealth, SystemServiceHealth] = [
  'healthy',
  'starting',
  'unhealthy',
];
const systemServiceNameValues: readonly [
  SystemServiceName,
  SystemServiceName,
  SystemServiceName,
  SystemServiceName,
  SystemServiceName,
  SystemServiceName,
  SystemServiceName,
  SystemServiceName,
  SystemServiceName,
] = ['api', 'registry', 'registry-auth', 'edge', 'node', 'builder', 'worker', 'caddy', 'postgres'];

const systemServiceStatusValues: readonly [
  SystemServiceStatus,
  SystemServiceStatus,
  SystemServiceStatus,
  SystemServiceStatus,
  SystemServiceStatus,
  SystemServiceStatus,
  SystemServiceStatus,
  SystemServiceStatus,
  SystemServiceStatus,
] = ['running', 'restarting', 'created', 'paused', 'removing', 'exited', 'dead', 'missing', 'unknown'];

export interface SystemServicePublishedPort {
  containerPort: number;
  hostIp?: string | undefined;
  hostPort: number;
}

export interface SystemServiceSummary {
  containerId: string | null;
  health: SystemServiceHealth | null;
  imageRef: string | null;
  name: SystemServiceName;
  publishedPorts: SystemServicePublishedPort[];
  startedAt: string | null;
  status: SystemServiceStatus;
  uptimeSeconds: number | null;
}

export interface SystemStatusDomainSummary {
  cliApiUrl: string;
  controlPlaneUrl: string;
}

export interface SystemStatusResponse {
  checkedAt: string;
  configDir: string;
  dataDir: string;
  domain: SystemStatusDomainSummary;
  dockerNamespace: string;
  imageRegistry: SelfHostedRuntimeImageRegistry;
  imageSource: SelfHostedImageSource;
  overallStatus: SystemOverallStatus;
  rollbackRetention: RollbackRetentionEffectivePolicy;
  services: SystemServiceSummary[];
}

export interface SystemRestartResponse {
  configDir: string;
  dataDir: string;
  restartedAt: string;
  services: SystemServiceName[];
}

const systemOverallStatusSchema: ContractSchema<SystemOverallStatus> = z.enum(systemOverallStatusValues);
const systemServiceHealthSchema: ContractSchema<SystemServiceHealth> = z.enum(systemServiceHealthValues);
const systemServiceNameSchema: ContractSchema<SystemServiceName> = z.enum(systemServiceNameValues);
const systemServiceStatusSchema: ContractSchema<SystemServiceStatus> = z.enum(systemServiceStatusValues);

const systemServicePublishedPortSchema: ContractSchema<SystemServicePublishedPort> = z
  .object({
    containerPort: z.number().int().positive(),
    hostIp: z.string().min(1).optional(),
    hostPort: z.number().int().positive(),
  })
  .strict();

const systemServiceSummarySchema: ContractSchema<SystemServiceSummary> = z
  .object({
    containerId: z.string().min(1).nullable(),
    health: systemServiceHealthSchema.nullable(),
    imageRef: z.string().min(1).nullable(),
    name: systemServiceNameSchema,
    publishedPorts: z.array(systemServicePublishedPortSchema),
    startedAt: z.string().datetime().nullable(),
    status: systemServiceStatusSchema,
    uptimeSeconds: z.number().int().nonnegative().nullable(),
  })
  .strict();

const systemStatusDomainSummarySchema: ContractSchema<SystemStatusDomainSummary> = z
  .object({
    cliApiUrl: z.string().url(),
    controlPlaneUrl: z.string().url(),
  })
  .strict();

export const systemStatusResponseSchema: ContractSchema<SystemStatusResponse> = z
  .object({
    checkedAt: z.string().datetime(),
    configDir: z.string().min(1),
    dataDir: z.string().min(1),
    domain: systemStatusDomainSummarySchema,
    dockerNamespace: z.string().min(1),
    imageRegistry: selfHostedRuntimeImageRegistrySchema,
    imageSource: selfHostedImageSourceSchema,
    overallStatus: systemOverallStatusSchema,
    rollbackRetention: rollbackRetentionEffectivePolicySchema,
    services: z.array(systemServiceSummarySchema),
  })
  .strict();

export const systemRestartResponseSchema: ContractSchema<SystemRestartResponse> = z
  .object({
    configDir: z.string().min(1),
    dataDir: z.string().min(1),
    restartedAt: z.string().datetime(),
    services: z.array(systemServiceNameSchema),
  })
  .strict();
