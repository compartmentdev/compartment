import { z } from 'zod';
import { compartmentProjectNameSchema, compartmentServiceNameSchema } from './compartment-descriptor.contract';
import { environmentNameSchema } from './deployments.contract';

const deploymentLogsEnvironmentNameSchema: z.ZodOptional<typeof environmentNameSchema> =
  environmentNameSchema.optional();
const deploymentLogsServiceNameSchema: z.ZodOptional<typeof compartmentServiceNameSchema> =
  compartmentServiceNameSchema.optional();
const deploymentLogsSinceSchema: z.ZodOptional<z.ZodString> = z.string().datetime().optional();
const deploymentLogsTailLinesSchema: z.ZodOptional<z.ZodNumber> = z.coerce
  .number()
  .int()
  .positive()
  .max(500)
  .optional();

interface DeploymentLogsQueryShape {
  environmentName: typeof deploymentLogsEnvironmentNameSchema;
  projectName: typeof compartmentProjectNameSchema;
  serviceName: typeof deploymentLogsServiceNameSchema;
  since: typeof deploymentLogsSinceSchema;
  tailLines: typeof deploymentLogsTailLinesSchema;
}

export const deploymentLogsQueryShape: DeploymentLogsQueryShape = {
  environmentName: deploymentLogsEnvironmentNameSchema,
  projectName: compartmentProjectNameSchema,
  serviceName: deploymentLogsServiceNameSchema,
  since: deploymentLogsSinceSchema,
  tailLines: deploymentLogsTailLinesSchema,
};
