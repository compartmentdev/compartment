import { z } from 'zod';
import type { ContractSchema } from './schema.types';

export interface RuntimePreviousDeployment {
  containerId: string;
  deploymentId: string;
  imageRef: string;
  nodeId: string;
  nodeSocketPath: string;
  upstreamHost: string;
  upstreamPort: number;
}

export interface RuntimeActiveDeployment {
  containerId: string;
  imageRef: string;
  routeHost: string;
  upstreamHost: string;
  upstreamPort: number;
}

export interface RuntimeDrainState {
  drainDeadlineAt?: string | undefined;
  drainingContainerId: string;
  drainingDeploymentId: string;
  drainingNodeId: string;
}

const compartmentDeploymentDrainDelayMs: number = 5_000;

type RuntimeActiveDeploymentObjectSchema = z.ZodObject<{
  containerId: z.ZodString;
  imageRef: z.ZodString;
  routeHost: z.ZodString;
  upstreamHost: z.ZodString;
  upstreamPort: z.ZodNumber;
}>;

export const runtimePreviousDeploymentSchema: ContractSchema<RuntimePreviousDeployment> = z
  .object({
    containerId: z.string().min(1),
    deploymentId: z.string().min(1),
    imageRef: z.string().min(1),
    nodeId: z.string().min(1),
    nodeSocketPath: z.string().min(1),
    upstreamHost: z.string().min(1),
    upstreamPort: z.number().int().positive(),
  })
  .strict();

export const runtimeActiveDeploymentSchema: RuntimeActiveDeploymentObjectSchema = z
  .object({
    containerId: z.string().min(1),
    imageRef: z.string().min(1),
    routeHost: z.string().min(1),
    upstreamHost: z.string().min(1),
    upstreamPort: z.number().int().positive(),
  })
  .strict();

export const runtimeDrainStateSchema: ContractSchema<RuntimeDrainState> = z
  .object({
    drainDeadlineAt: z.string().datetime().optional(),
    drainingContainerId: z.string().min(1),
    drainingDeploymentId: z.string().min(1),
    drainingNodeId: z.string().min(1),
  })
  .strict();

export function buildDeploymentDrainDeadline(nowMs: number = Date.now()): string {
  return new Date(nowMs + compartmentDeploymentDrainDelayMs).toISOString();
}

export function buildCompartmentArtifactImageRepository(projectId: string, serviceId: string): string {
  return `compartment/projects/${projectId}/services/${serviceId}`;
}

export function buildCompartmentArtifactImageTag(
  registryAddress: string,
  imageRepository: string,
  artifactId: string,
): string {
  return `${registryAddress}/${imageRepository}:${artifactId}`;
}
