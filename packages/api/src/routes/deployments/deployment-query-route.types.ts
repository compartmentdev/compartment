import type { PermissionKey } from '@compartment/contracts';
import type { ApiApp } from '../../app.types';
import type { FastifyRequest } from 'fastify';
import type { StatusLookupInput } from '../../services/deployments.service.types';
import type { ZodType } from 'zod';

export interface DeploymentQueryRouteQuery {
  deploymentId?: string | undefined;
  environmentName?: string | undefined;
  projectName: string;
  serviceName?: string | undefined;
}

export interface RegisterDeploymentQueryRouteInput<TQuery extends DeploymentQueryRouteQuery, TSummary, TResponse> {
  app: ApiApp;
  buildResponse: (summary: TSummary, request: FastifyRequest) => Promise<TResponse> | TResponse;
  currentOrganizationPermission?: PermissionKey | undefined;
  invalidQueryErrorCode: string;
  loadSummary: (input: StatusLookupInput) => Promise<TSummary>;
  path: string;
  querySchema: ZodType<TQuery>;
  responseSchema: ZodType<TResponse>;
}
