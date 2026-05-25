import { z } from 'zod';
import type { ContractSchema } from './schema.types';
import type {
  CliLoginExchangeRequest,
  CliLoginExchangeResponse,
  CliLoginStartRequest,
  CliLoginStartResponse,
  CliLoginStatusRequest,
  CliLoginStatusResponse,
} from './auth.contract.types';
import { loginTokenResponseSchema } from './auth.contract';

export const cliLoginStartRequestSchema: ContractSchema<CliLoginStartRequest> = z
  .object({
    email: z.string().email().optional(),
    onboardingSessionId: z.string().min(1).optional(),
    organizationSlug: z.string().min(1).optional(),
  })
  .strict();

export const cliLoginStartResponseSchema: ContractSchema<CliLoginStartResponse> = z
  .object({
    attemptId: z.string().min(1),
    exchangeSecret: z.string().min(1),
    expiresAt: z.string().datetime(),
    pollAfterMs: z.number().int().positive(),
    verificationUrl: z.string().url(),
  })
  .strict();

export const cliLoginStatusRequestSchema: ContractSchema<CliLoginStatusRequest> = z
  .object({
    attemptId: z.string().min(1),
    exchangeSecret: z.string().min(1),
  })
  .strict();

export const cliLoginStatusResponseSchema: ContractSchema<CliLoginStatusResponse> = z.discriminatedUnion('status', [
  z.object({ expiresAt: z.string().datetime(), status: z.literal('pending') }).strict(),
  z.object({ expiresAt: z.string().datetime(), status: z.literal('authenticated') }).strict(),
  z.object({ expiresAt: z.string().datetime(), status: z.literal('expired') }).strict(),
  z.object({ expiresAt: z.string().datetime(), status: z.literal('exchanged') }).strict(),
]);

export const cliLoginExchangeRequestSchema: ContractSchema<CliLoginExchangeRequest> = z
  .object({
    attemptId: z.string().min(1),
    exchangeSecret: z.string().min(1),
  })
  .strict();

export const cliLoginExchangeResponseSchema: ContractSchema<CliLoginExchangeResponse> = loginTokenResponseSchema;
