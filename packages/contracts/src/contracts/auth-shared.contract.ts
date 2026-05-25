import { z } from 'zod';
import { appAccessBrowserFlowTargetSchema, appAccessFlowStateSchema } from './app-access-protocol.contract';
import type {
  AuthTokenStateQuery,
  AuthTokenStateResponse,
  AuthSessionDelivery,
  PrincipalSummary,
} from './auth.contract.types';
import type { ContractSchema } from './schema.types';

interface AuthFlowFieldsSchemaShape {
  host: z.ZodOptional<z.ZodString>;
  path: z.ZodOptional<z.ZodString>;
  state: z.ZodOptional<typeof appAccessFlowStateSchema>;
}

interface AuthTokenStateResponseSchemaShape {
  email: z.ZodOptional<z.ZodString>;
  flowTarget: z.ZodNullable<typeof appAccessBrowserFlowTargetSchema>;
  hasToken: z.ZodBoolean;
  principalEmail: z.ZodOptional<z.ZodString>;
}

export const principalSummarySchema: ContractSchema<PrincipalSummary> = z
  .object({
    id: z.string().min(1),
    type: z.literal('user'),
    email: z.string().email(),
  })
  .strict();

export const authSessionDeliverySchema: ContractSchema<AuthSessionDelivery> = z.enum(['cookie', 'token']);

export const authFlowFieldsSchema: AuthFlowFieldsSchemaShape = {
  host: z.string().min(1).optional(),
  path: z.string().min(1).optional(),
  state: appAccessFlowStateSchema.optional(),
};

export const authTokenStateQuerySchema: ContractSchema<AuthTokenStateQuery> = z
  .object({
    ...authFlowFieldsSchema,
    email: z.string().email().optional(),
  })
  .strict();

const authTokenStateResponseSchemaShape: AuthTokenStateResponseSchemaShape = {
  email: z.string().email().optional(),
  flowTarget: appAccessBrowserFlowTargetSchema.nullable(),
  hasToken: z.boolean(),
  principalEmail: z.string().email().optional(),
};

const authTokenStateResponseObjectSchema: ContractSchema<AuthTokenStateResponse> = z
  .object({ ...authTokenStateResponseSchemaShape })
  .strict();
export { authTokenStateResponseSchemaShape };

export const authTokenStateResponseSchema: ContractSchema<AuthTokenStateResponse> = authTokenStateResponseObjectSchema;
