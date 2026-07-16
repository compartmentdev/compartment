import { z } from 'zod';
import { type DeploymentSummary, deploymentSummarySchema } from './deployments.contract';
import { compartmentProjectNameSchema, compartmentServiceNameSchema } from './compartment-descriptor.contract';
import { compartmentRouteRuleSchema, type CompartmentRouteRule } from './compartment-routes.contract';
import { environmentNameSchema, environmentSummarySchema, type EnvironmentSummary } from './environments.contract';
import { projectSummarySchema, type ProjectSummary } from './projects.contract';
import type { ContractSchema } from './schema.types';

export interface DeploymentInspectRuntimeSummary {
  imageRef: string;
  routeHost: string;
  serviceHost: string;
  servicePort: number;
}

export interface DeploymentInspectTarget extends DeploymentSummary {
  routes: CompartmentRouteRule[];
  routeHost: string | null;
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

const deploymentInspectRuntimeSummarySchema: ContractSchema<DeploymentInspectRuntimeSummary> = z
  .object({
    imageRef: z.string().min(1),
    routeHost: z.string().min(1),
    serviceHost: z.string().min(1),
    servicePort: z.number().int().positive(),
  })
  .strict();

const deploymentInspectTargetSchema: ContractSchema<DeploymentInspectTarget> = deploymentSummarySchema
  .extend({
    routes: z.array(compartmentRouteRuleSchema),
    routeHost: z.string().min(1).nullable(),
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
