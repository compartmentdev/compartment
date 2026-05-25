import type { FastifyRequest } from 'fastify';
import type { ApiApp } from '../../app.types';
import '../../http/request.types';
import { parseRequestValue } from '../../http/validation';
import { rejectOrganizationUserPasswordReset } from '../../services/password-reset-issue.service';
import { createCurrentOrganizationRouteOptions } from '../protected/current-organization-route';
import { userRouteParamsSchema, type UserRouteParams } from './user.route.types';
import { userPasswordResetApiPathname } from './users-api-paths';

export function registerPostUserPasswordResetRoute(app: ApiApp): void {
  app.post(
    userPasswordResetApiPathname,
    createCurrentOrganizationRouteOptions('organization.user.credentials.reset'),
    handlePostUserPasswordReset,
  );
}

async function handlePostUserPasswordReset(request: FastifyRequest): Promise<never> {
  const params: UserRouteParams = parseRequestValue(userRouteParamsSchema, request.params, 'invalid_user_params');

  return await rejectOrganizationUserPasswordReset({
    email: params.email,
    organizationId: request.currentOrganization.id,
  });
}
