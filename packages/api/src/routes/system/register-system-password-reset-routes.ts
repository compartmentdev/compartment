import {
  buildFastifyResponseSchemas,
  issuePasswordResetRequestSchema,
  issuePasswordResetResponseSchema,
  compartmentSystemIssuePasswordResetPathname,
  type IssuePasswordResetRequest,
  type IssuePasswordResetResponse,
} from '@compartment/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiApp } from '../../app.types';
import { createApiRateLimitRouteOptions } from '../../http/rate-limit';
import { apiRouteRateLimitPolicies } from '../../http/rate-limit-policies';
import type { ApiRateLimitRouteOptions } from '../../http/rate-limit.types';
import { parseRequestValue } from '../../http/validation';
import { issuePasswordReset } from '../../services/password-reset-issue.service';
import type { IssuePasswordResetResult } from '../../services/password-reset-issue.service.types';
import { authenticateSystemRequest } from '../system-domain/authenticate-system-request';

const systemPasswordResetRouteOptions: ApiRateLimitRouteOptions = createApiRateLimitRouteOptions(
  apiRouteRateLimitPolicies.systemPasswordReset,
);

export function registerSystemPasswordResetRoutes(app: ApiApp): void {
  app.after((): void => {
    app.addHook('preHandler', authenticateSystemRequest);
    app.post(
      compartmentSystemIssuePasswordResetPathname,
      {
        ...systemPasswordResetRouteOptions,
        schema: {
          response: buildFastifyResponseSchemas({
            200: issuePasswordResetResponseSchema,
          }),
        },
      },
      handleIssuePasswordResetRequest,
    );
  });
}

async function handleIssuePasswordResetRequest(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const requestBody: IssuePasswordResetRequest = parseRequestValue(
    issuePasswordResetRequestSchema,
    request.body,
    'invalid_issue_password_reset_request',
  );
  const result: IssuePasswordResetResult = await issuePasswordReset({
    email: requestBody.email,
  });
  const response: IssuePasswordResetResponse = issuePasswordResetResponseSchema.parse({
    email: result.email,
    expiresAt: result.expiresAt.toISOString(),
    resetToken: result.resetToken,
    resetUrl: result.resetUrl,
  });

  return await reply.send(response);
}
