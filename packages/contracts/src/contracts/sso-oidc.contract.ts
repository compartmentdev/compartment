import { z } from 'zod';
import { compartmentMembershipRoleSchema, type CompartmentMembershipRole } from './access.contract';
import type { ContractSchema } from './schema.types';
import {
  validateCreateSsoOidcProviderMutation,
  validateUpdateSsoOidcProviderMutation,
} from './sso-oidc.contract.validation';

export type SsoOidcProviderPreset = 'generic' | 'google';
export type SsoOidcIdentityClaimSource = 'id_token' | 'userinfo';
export type SsoOidcIdentityClaimExpectedValue = boolean | number | string;

export interface SsoOidcIdentityClaimReference {
  claim: string;
  source: SsoOidcIdentityClaimSource;
}

export interface SsoOidcIdentityVerifiedClaimReference extends SsoOidcIdentityClaimReference {
  equals?: SsoOidcIdentityClaimExpectedValue | undefined;
}

export interface SsoOidcIdentityVerificationConfig {
  emailClaims: SsoOidcIdentityClaimReference[];
  emailVerifiedClaims: SsoOidcIdentityVerifiedClaimReference[];
  verifiedEmailClaims: SsoOidcIdentityClaimReference[];
}

export interface DisabledSsoOidcProvisioningPolicy {
  autoJoinEnabled: false;
}

export interface EnabledSsoOidcProvisioningPolicy {
  allowedEmailDomains: string[];
  autoJoinEnabled: true;
  defaultRole: CompartmentMembershipRole;
}

export type SsoOidcProvisioningPolicy = DisabledSsoOidcProvisioningPolicy | EnabledSsoOidcProvisioningPolicy;

export interface SsoOidcProviderSummary {
  buttonText: string;
  clientId: string;
  createdAt: string;
  displayName: string;
  id: string;
  identityVerification: SsoOidcIdentityVerificationConfig;
  issuerUrl: string;
  key: string;
  preset: SsoOidcProviderPreset;
  provisioning: SsoOidcProvisioningPolicy;
  scope: string;
  updatedAt: string;
}

export interface ConfigureSsoOidcProviderRequest {
  buttonText?: string | undefined;
  clientId: string;
  clientSecret: string;
  displayName?: string | undefined;
  identityVerification?: SsoOidcIdentityVerificationConfig | undefined;
  issuerUrl?: string | undefined;
  key: string;
  preset: SsoOidcProviderPreset;
  provisioning?: SsoOidcProvisioningPolicy | undefined;
  scope?: string | undefined;
}

export interface UpdateSsoOidcProviderRequest {
  buttonText?: string | undefined;
  clientId?: string | undefined;
  clientSecret?: string | undefined;
  displayName?: string | undefined;
  identityVerification?: SsoOidcIdentityVerificationConfig | undefined;
  issuerUrl?: string | undefined;
  key?: string | undefined;
  preset?: SsoOidcProviderPreset | undefined;
  provisioning?: SsoOidcProvisioningPolicy | undefined;
  scope?: string | undefined;
}

export interface SsoOidcProviderResponse {
  provider: SsoOidcProviderSummary | null;
}

export interface SsoOidcProviderListResponse {
  providers: SsoOidcProviderSummary[];
}

export interface DeleteSsoOidcProviderResponse {
  success: true;
}

const ssoOidcProviderPresetSchema: ContractSchema<SsoOidcProviderPreset> = z.enum(['generic', 'google']);
const ssoOidcIdentityClaimSourceSchema: ContractSchema<SsoOidcIdentityClaimSource> = z.enum(['id_token', 'userinfo']);
const requiredOidcScope: string = 'openid';
const ssoOidcProviderKeySchema: ContractSchema<string> = z
  .string()
  .min(1)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u, 'Provider key must use lowercase letters, numbers, and hyphens only.');

const ssoOidcIdentityClaimReferenceSchema: ContractSchema<SsoOidcIdentityClaimReference> = z
  .object({
    claim: z.string().min(1),
    source: ssoOidcIdentityClaimSourceSchema,
  })
  .strict();

const ssoOidcIdentityVerifiedClaimReferenceSchema: ContractSchema<SsoOidcIdentityVerifiedClaimReference> = z
  .object({
    claim: z.string().min(1),
    equals: z.union([z.boolean(), z.number(), z.string().min(1)]).optional(),
    source: ssoOidcIdentityClaimSourceSchema,
  })
  .strict();

export const ssoOidcIdentityVerificationConfigSchema: ContractSchema<SsoOidcIdentityVerificationConfig> = z
  .object({
    emailClaims: z.array(ssoOidcIdentityClaimReferenceSchema),
    emailVerifiedClaims: z.array(ssoOidcIdentityVerifiedClaimReferenceSchema),
    verifiedEmailClaims: z.array(ssoOidcIdentityClaimReferenceSchema),
  })
  .strict()
  .superRefine((value: SsoOidcIdentityVerificationConfig, context: z.RefinementCtx): void => {
    if (value.emailClaims.length === 0 && value.verifiedEmailClaims.length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'OIDC identity verification requires at least one email claim.',
        path: ['emailClaims'],
      });
    }
  });

export const ssoOidcProvisioningPolicySchema: ContractSchema<SsoOidcProvisioningPolicy> = z.discriminatedUnion(
  'autoJoinEnabled',
  [
    z
      .object({
        autoJoinEnabled: z.literal(false),
      })
      .strict(),
    z
      .object({
        allowedEmailDomains: z.array(z.string().min(1)).min(1),
        autoJoinEnabled: z.literal(true),
        defaultRole: compartmentMembershipRoleSchema,
      })
      .strict(),
  ],
);

const ssoOidcProviderSummarySchema: ContractSchema<SsoOidcProviderSummary> = z
  .object({
    buttonText: z.string().min(1),
    clientId: z.string().min(1),
    createdAt: z.string().datetime(),
    displayName: z.string().min(1),
    id: z.string().min(1),
    identityVerification: ssoOidcIdentityVerificationConfigSchema,
    issuerUrl: z.string().url(),
    key: ssoOidcProviderKeySchema,
    preset: ssoOidcProviderPresetSchema,
    provisioning: ssoOidcProvisioningPolicySchema,
    scope: z.string().min(1),
    updatedAt: z.string().datetime(),
  })
  .strict();

const ssoOidcProviderCreateMutationShape: {
  buttonText: z.ZodOptional<z.ZodString>;
  clientId: z.ZodString;
  displayName: z.ZodOptional<z.ZodString>;
  identityVerification: z.ZodOptional<typeof ssoOidcIdentityVerificationConfigSchema>;
  issuerUrl: z.ZodOptional<z.ZodString>;
  preset: typeof ssoOidcProviderPresetSchema;
  provisioning: z.ZodOptional<typeof ssoOidcProvisioningPolicySchema>;
  scope: z.ZodOptional<z.ZodString>;
} = {
  buttonText: z.string().min(1).optional(),
  clientId: z.string().min(1),
  displayName: z.string().min(1).optional(),
  identityVerification: ssoOidcIdentityVerificationConfigSchema.optional(),
  issuerUrl: z.string().url().optional(),
  preset: ssoOidcProviderPresetSchema,
  provisioning: ssoOidcProvisioningPolicySchema.optional(),
  scope: z.string().min(1).optional(),
};

const ssoOidcProviderUpdateMutationShape: {
  buttonText: z.ZodOptional<z.ZodString>;
  clientId: z.ZodOptional<z.ZodString>;
  displayName: z.ZodOptional<z.ZodString>;
  identityVerification: z.ZodOptional<typeof ssoOidcIdentityVerificationConfigSchema>;
  issuerUrl: z.ZodOptional<z.ZodString>;
  preset: z.ZodOptional<typeof ssoOidcProviderPresetSchema>;
  provisioning: z.ZodOptional<typeof ssoOidcProvisioningPolicySchema>;
  scope: z.ZodOptional<z.ZodString>;
} = {
  buttonText: z.string().min(1).optional(),
  clientId: z.string().min(1).optional(),
  displayName: z.string().min(1).optional(),
  identityVerification: ssoOidcIdentityVerificationConfigSchema.optional(),
  issuerUrl: z.string().url().optional(),
  preset: ssoOidcProviderPresetSchema.optional(),
  provisioning: ssoOidcProvisioningPolicySchema.optional(),
  scope: z.string().min(1).optional(),
};

export const configureSsoOidcProviderRequestSchema: ContractSchema<ConfigureSsoOidcProviderRequest> = z
  .object({
    ...ssoOidcProviderCreateMutationShape,
    clientSecret: z.string().min(1),
    key: ssoOidcProviderKeySchema,
  })
  .strict()
  .superRefine((value: ConfigureSsoOidcProviderRequest, context: z.RefinementCtx): void => {
    validateCreateSsoOidcProviderMutation(value, context, requiredOidcScope);
  });

export const updateSsoOidcProviderRequestSchema: ContractSchema<UpdateSsoOidcProviderRequest> = z
  .object({
    ...ssoOidcProviderUpdateMutationShape,
    clientSecret: z.string().min(1).optional(),
    key: ssoOidcProviderKeySchema.optional(),
  })
  .strict()
  .superRefine((value: UpdateSsoOidcProviderRequest, context: z.RefinementCtx): void => {
    validateUpdateSsoOidcProviderMutation(value, context, requiredOidcScope);
  });

export const ssoOidcProviderResponseSchema: ContractSchema<SsoOidcProviderResponse> = z
  .object({
    provider: ssoOidcProviderSummarySchema.nullable(),
  })
  .strict();

export const ssoOidcProviderListResponseSchema: ContractSchema<SsoOidcProviderListResponse> = z
  .object({
    providers: z.array(ssoOidcProviderSummarySchema),
  })
  .strict();

export const deleteSsoOidcProviderResponseSchema: ContractSchema<DeleteSsoOidcProviderResponse> = z
  .object({
    success: z.literal(true),
  })
  .strict();

export function buildDefaultSsoOidcIdentityVerificationConfig(): SsoOidcIdentityVerificationConfig {
  return {
    emailClaims: [{ claim: 'email', source: 'id_token' }],
    emailVerifiedClaims: [{ claim: 'email_verified', equals: true, source: 'id_token' }],
    verifiedEmailClaims: [],
  };
}

export function buildDisabledSsoOidcProvisioningPolicy(): DisabledSsoOidcProvisioningPolicy {
  return {
    autoJoinEnabled: false,
  };
}
