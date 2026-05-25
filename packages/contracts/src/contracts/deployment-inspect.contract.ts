import { z } from 'zod';
import { type DeploymentSummary, deploymentSummarySchema } from './deployments.contract';
import { compartmentProjectNameSchema, compartmentServiceNameSchema } from './compartment-descriptor.contract';
import { compartmentRouteRuleSchema, type CompartmentRouteRule } from './compartment-routes.contract';
import { environmentNameSchema, environmentSummarySchema, type EnvironmentSummary } from './environments.contract';
import { projectSummarySchema, type ProjectSummary } from './projects.contract';
import type { ContractSchema } from './schema.types';

interface DeploymentDrainState {
  containerId: string;
  deadlineAt: string | null;
}

export interface DeploymentInspectRuntimeSummary {
  containerId: string;
  imageRef: string;
  routeHost: string;
  upstreamHost: string | null;
  upstreamPort: number | null;
}

export interface DeploymentInspectTarget extends DeploymentSummary {
  drain: DeploymentDrainState | null;
  routes: CompartmentRouteRule[];
  routeHost: string | null;
  upstreamHost: string | null;
  upstreamPort: number | null;
  runtime: DeploymentInspectRuntimeSummary | null;
}

export interface DeploymentInspectQuery {
  deploymentId?: string | undefined;
  environmentName?: string | undefined;
  projectName: string;
  serviceName?: string | undefined;
}

export interface DeploymentInspectResponse {
  activeDeployments: DeploymentInspectTarget[];
  deployments: DeploymentInspectTarget[];
  environment: EnvironmentSummary;
  project: ProjectSummary;
  sensitiveTopologyVisible: boolean;
}

const deploymentDrainStateSchema: ContractSchema<DeploymentDrainState> = z
  .object({
    containerId: z.string().min(1),
    deadlineAt: z.string().datetime().nullable(),
  })
  .strict();

const deploymentInspectRuntimeSummarySchema: ContractSchema<DeploymentInspectRuntimeSummary> = z
  .object({
    containerId: z.string().min(1),
    imageRef: z.string().min(1),
    routeHost: z.string().min(1),
    upstreamHost: z.string().min(1).nullable(),
    upstreamPort: z.number().int().positive().nullable(),
  })
  .strict();

const deploymentInspectTargetSchema: ContractSchema<DeploymentInspectTarget> = deploymentSummarySchema
  .extend({
    drain: deploymentDrainStateSchema.nullable(),
    routes: z.array(compartmentRouteRuleSchema),
    routeHost: z.string().min(1).nullable(),
    upstreamHost: z.string().min(1).nullable(),
    upstreamPort: z.number().int().positive().nullable(),
    runtime: deploymentInspectRuntimeSummarySchema.nullable(),
  })
  .strict();

export const deploymentInspectQuerySchema: ContractSchema<DeploymentInspectQuery> = z
  .object({
    deploymentId: z.string().min(1).optional(),
    environmentName: environmentNameSchema.optional(),
    projectName: compartmentProjectNameSchema,
    serviceName: compartmentServiceNameSchema.optional(),
  })
  .strict();

export const deploymentInspectResponseSchema: ContractSchema<DeploymentInspectResponse> = z
  .object({
    activeDeployments: z.array(deploymentInspectTargetSchema),
    deployments: z.array(deploymentInspectTargetSchema),
    environment: environmentSummarySchema,
    project: projectSummarySchema,
    sensitiveTopologyVisible: z.boolean(),
  })
  .strict();
