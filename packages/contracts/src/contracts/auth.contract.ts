import { z } from 'zod';
import { appAccessBrowserFlowTargetSchema } from './app-access-protocol.contract';
import { permissionKeySchema } from './access.contract';
import { compartmentProjectNameSchema } from './compartment-descriptor.contract';
import { environmentNameSchema } from './environments.contract';
import { organizationSummarySchema } from './organizations.contract';
import type { ContractSchema } from './schema.types';
import {
  authFlowFieldsSchema,
  authSessionDeliverySchema,
  authTokenStateQuerySchema,
  authTokenStateResponseSchemaShape,
  principalSummarySchema,
} from './auth-shared.contract';
import type {
  ActivateRequest,
  ActivateResponse,
  ActivateStateQuery,
  ActivateStateResponse,
  ActivateUnavailableReason,
  AuthFlowTargetFields,
  LoginDiscoveryRequest,
  LoginCookieResponse,
  LoginOrganizationChoice,
  LoginRequest,
  LoginResponse,
  LoginTokenResponse,
  LoginSsoProviderOption,
  LoginStateQuery,
  LoginStateResponse,
  LogoutResponse,
  WhoAmIQuery,
  WhoAmICommandResponse,
  WhoAmIResponse,
} from './auth.contract.types';

export type {
  ActivateRequest,
  ActivateResponse,
  ActivateStateQuery,
  ActivateStateResponse,
  ActivateUnavailableReason,
  AuthSessionDelivery,
  AuthTokenStateResponse,
  CliLoginExchangeRequest,
  CliLoginExchangeResponse,
  CliLoginStartRequest,
  CliLoginStartResponse,
  CliLoginStatusRequest,
  CliLoginStatusResponse,
  LoginDiscoveryRequest,
  LoginOrganizationChoice,
  LoginRequest,
  LoginResponse,
  LoginSsoProviderOption,
  LoginStateQuery,
  LoginStateResponse,
  LogoutResponse,
  WhoAmIQuery,
  PrincipalSummary,
  WhoAmICommandResponse,
  WhoAmIResponse,
} from './auth.contract.types';
const loginOrganizationChoiceSchema: ContractSchema<LoginOrganizationChoice> = z
  .object({
    name: z.string().min(1),
    slug: z.string().min(1),
  })
  .strict();
const loginSsoProviderOptionSchema: ContractSchema<LoginSsoProviderOption> = z
  .object({
    buttonText: z.string().min(1),
    loginUrl: z.string().min(1),
    providerId: z.string().min(1),
  })
  .strict();

const activateUnavailableReasonSchema: ContractSchema<ActivateUnavailableReason> = z.enum(['local_password_disabled']);

interface LoginStateQueryInput extends AuthFlowTargetFields {
  autoRedirect?: boolean | string | undefined;
}

const authBooleanQuerySchema: z.ZodType<boolean, z.ZodTypeDef, boolean | string> = z.union([
  z.boolean(),
  z.literal('true').transform((): boolean => true),
  z.literal('false').transform((): boolean => false),
]);

export const loginStateQuerySchema: z.ZodType<LoginStateQuery, z.ZodTypeDef, LoginStateQueryInput> = z
  .object({
    ...authFlowFieldsSchema,
    autoRedirect: authBooleanQuerySchema.optional(),
  })
  .strict();

export const loginDiscoveryRequestSchema: ContractSchema<LoginDiscoveryRequest> = z
  .object({
    autoRedirect: z.boolean().optional(),
    ...authFlowFieldsSchema,
    email: z.string().email(),
    organizationSlug: z.string().min(1).optional(),
  })
  .strict();

export const loginRequestSchema: ContractSchema<LoginRequest> = z
  .object({
    ...authFlowFieldsSchema,
    email: z.string().email(),
    organizationSlug: z.string().min(1).optional(),
    password: z.string().min(8),
    sessionDelivery: authSessionDeliverySchema.optional(),
  })
  .strict();

export const activateRequestSchema: ContractSchema<ActivateRequest> = z
  .object({
    ...authFlowFieldsSchema,
    bootstrapToken: z.string().min(1).optional(),
    email: z.string().email(),
    password: z.string().min(8),
    sessionDelivery: authSessionDeliverySchema.optional(),
  })
  .strict();

export const loginTokenResponseSchema: ContractSchema<LoginTokenResponse> = z
  .object({
    organizations: z.array(organizationSummarySchema).min(1),
    principal: principalSummarySchema,
    redirectTo: z.never().optional(),
    sessionToken: z.string().min(1),
  })
  .strict();

const loginCookieResponseSchema: ContractSchema<LoginCookieResponse> = z
  .object({
    organizations: z.array(organizationSummarySchema).min(1),
    principal: principalSummarySchema,
    redirectTo: z.string().min(1),
    sessionToken: z.never().optional(),
  })
  .strict();

export const loginResponseSchema: ContractSchema<LoginResponse> = z.union([
  loginTokenResponseSchema,
  loginCookieResponseSchema,
]);

export const activateResponseSchema: ContractSchema<ActivateResponse> = z.union([
  z
    .object({
      organizations: z.array(organizationSummarySchema),
      principal: principalSummarySchema,
      redirectTo: z.never().optional(),
      sessionToken: z.string().min(1),
    })
    .strict(),
  z
    .object({
      organizations: z.array(organizationSummarySchema),
      principal: principalSummarySchema,
      redirectTo: z.string().min(1),
      sessionToken: z.never().optional(),
    })
    .strict(),
]);

export const loginStateResponseSchema: ContractSchema<LoginStateResponse> = z.discriminatedUnion('view', [
  z
    .object({
      flowTarget: appAccessBrowserFlowTargetSchema.nullable(),
      principalEmail: z.string().email().optional(),
      view: z.literal('email_entry'),
    })
    .strict(),
  z
    .object({
      email: z.string().email().optional(),
      flowTarget: appAccessBrowserFlowTargetSchema.nullable(),
      localPasswordEnabled: z.boolean(),
      organizationSlug: z.string().min(1).optional(),
      principalEmail: z.string().email().optional(),
      ssoOptions: z.array(loginSsoProviderOptionSchema),
      view: z.literal('methods'),
    })
    .strict(),
  z
    .object({
      email: z.string().email(),
      flowTarget: appAccessBrowserFlowTargetSchema.nullable(),
      organizationChoices: z.array(loginOrganizationChoiceSchema),
      principalEmail: z.string().email().optional(),
      view: z.literal('organization_selection'),
    })
    .strict(),
  z
    .object({
      flowTarget: appAccessBrowserFlowTargetSchema.nullable(),
      principalEmail: z.string().email().optional(),
      redirectTo: z.string().min(1),
      view: z.literal('redirect'),
    })
    .strict(),
]);

export const activateStateQuerySchema: ContractSchema<ActivateStateQuery> = authTokenStateQuerySchema;

export const activateStateResponseSchema: ContractSchema<ActivateStateResponse> = z
  .object({
    ...authTokenStateResponseSchemaShape,
    unavailableReason: activateUnavailableReasonSchema.optional(),
  })
  .strict();

export const logoutResponseSchema: ContractSchema<LogoutResponse> = z
  .object({
    success: z.literal(true),
  })
  .strict();

export const whoamiQuerySchema: ContractSchema<WhoAmIQuery> = z
  .object({
    environmentName: environmentNameSchema.optional(),
    projectName: compartmentProjectNameSchema.optional(),
  })
  .strict()
  .superRefine((value: WhoAmIQuery, context: z.RefinementCtx): void => {
    const hasEnvironmentName: boolean = value.environmentName !== undefined;
    const hasProjectName: boolean = value.projectName !== undefined;
    if (hasEnvironmentName === hasProjectName) {
      return;
    }

    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'projectName and environmentName must be provided together.',
      path: hasProjectName ? ['projectName'] : ['environmentName'],
    });
  });

export const whoamiResponseSchema: ContractSchema<WhoAmIResponse> = z
  .object({
    principal: principalSummarySchema,
    currentOrganization: organizationSummarySchema.nullable(),
    currentOrganizationPermissions: z.array(permissionKeySchema),
  })
  .strict();

export const whoamiCommandResponseSchema: ContractSchema<WhoAmICommandResponse> = z
  .object({
    apiUrl: z.string().url(),
    principal: principalSummarySchema,
    currentOrganization: organizationSummarySchema.nullable(),
    remoteName: z.string().min(1),
  })
  .strict();
