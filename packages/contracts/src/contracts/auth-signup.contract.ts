import { z } from 'zod';
import { principalSummarySchema } from './auth-shared.contract';
import { loginTokenResponseSchema } from './auth.contract';
import type { ContractSchema } from './schema.types';
import type {
  ClaimAccountRequest,
  ClaimAccountResponse,
  SignupRequest,
  SignupResponse,
} from './auth-signup.contract.types';

export type {
  ClaimAccountRequest,
  ClaimAccountResponse,
  SignupRequest,
  SignupResponse,
} from './auth-signup.contract.types';

export const signupRequestSchema: ContractSchema<SignupRequest> = z
  .object({
    email: z.string().email().optional(),
    organizationName: z.string().min(1),
  })
  .strict();

export const signupResponseSchema: ContractSchema<SignupResponse> = loginTokenResponseSchema;

export const claimAccountRequestSchema: ContractSchema<ClaimAccountRequest> = z
  .object({
    email: z.string().email(),
    password: z.string().min(8),
  })
  .strict();

export const claimAccountResponseSchema: ContractSchema<ClaimAccountResponse> = z
  .object({
    principal: principalSummarySchema,
  })
  .strict();
