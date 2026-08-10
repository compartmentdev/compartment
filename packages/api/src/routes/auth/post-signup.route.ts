import {
  buildFastifyResponseSchemas,
  signupRequestSchema,
  signupResponseSchema,
  type SignupRequest,
  type SignupResponse,
} from '@compartment/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiApp } from '../../app.types';
import { parseRequestValue } from '../../http/validation';
import { requireInstalledCompartment } from '../../services/app-access-target.service';
import { signUp } from '../../services/signup.service';
import type { SignupResult } from '../../services/signup.service.types';
import { authApiSignupPathname } from './auth-api-paths';
import { authSignupRateLimitRouteOptions } from './auth-rate-limit.route';
import { buildAuthSessionResponseBaseFields } from './auth-session-response.helpers';

export function registerPostSignupRoute(app: ApiApp): void {
  app.post(
    authApiSignupPathname,
    {
      ...authSignupRateLimitRouteOptions,
      schema: {
        response: buildFastifyResponseSchemas({
          200: signupResponseSchema,
        }),
      },
    },
    handlePostSignup,
  );
}

async function handlePostSignup(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  await requireInstalledCompartment();
  const requestBody: SignupRequest = parseRequestValue(signupRequestSchema, request.body, 'invalid_signup_request');
  const result: SignupResult = await signUp({
    email: requestBody.email,
    organizationName: requestBody.organizationName,
  });
  const response: SignupResponse = signupResponseSchema.parse({
    ...buildAuthSessionResponseBaseFields(result.organizations, result.principalEmail, result.principalId),
    sessionToken: result.sessionToken,
  });

  return await reply.send(response);
}
