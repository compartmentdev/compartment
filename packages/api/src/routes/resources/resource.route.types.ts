import { z, type ZodType } from 'zod';
import {
  compartmentResourceOutputNameSchema,
  compartmentResourceNameSchema,
  resourceOutputQuerySchema,
  resourceListQuerySchema,
  resourceLogsQuerySchema,
  resourceBackupShowQuerySchema,
  resourceTargetQuerySchema,
  type ResourceListQuery,
  type ResourceOutputQuery,
  type ResourceLogsQuery,
  type ResourceBackupShowQuery,
  type ResourceTargetQuery,
} from '@compartment/contracts';

export interface ResourceRouteParams {
  resourceName: string;
}

export interface ResourceOutputRouteParams extends ResourceRouteParams {
  outputName: string;
}

export const resourceRouteParamsSchema: ZodType<ResourceRouteParams> = z
  .object({
    resourceName: compartmentResourceNameSchema,
  })
  .strict();
export const resourceOutputRouteParamsSchema: ZodType<ResourceOutputRouteParams> = z
  .object({
    resourceName: compartmentResourceNameSchema,
    outputName: compartmentResourceOutputNameSchema,
  })
  .strict();

export const resourceListRouteQuerySchema: typeof resourceListQuerySchema = resourceListQuerySchema;
export const resourceTargetRouteQuerySchema: typeof resourceTargetQuerySchema = resourceTargetQuerySchema;
export const resourceOutputRouteQuerySchema: typeof resourceOutputQuerySchema = resourceOutputQuerySchema;
export const resourceLogsRouteQuerySchema: typeof resourceLogsQuerySchema = resourceLogsQuerySchema;
export const resourceBackupShowRouteQuerySchema: typeof resourceBackupShowQuerySchema = resourceBackupShowQuerySchema;

export type { ResourceListQuery, ResourceOutputQuery, ResourceLogsQuery, ResourceBackupShowQuery, ResourceTargetQuery };
