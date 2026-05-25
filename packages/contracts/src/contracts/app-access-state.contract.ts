import { z } from 'zod';
import {
  appRouteAccessModeSchema,
  appAccessScopeTypeSchema,
  accessAssignmentScopeTypeSchema,
  type AppRouteAccessMode,
  type AccessAssignmentScopeType,
  type AppAccessScopeType,
  permissionKeySchema,
  type PermissionKey,
} from './access.contract';
import { type CompartmentRouteRule } from './compartment-routes.contract';
import { createCompartmentRouteRuleShape, validateCompartmentRouteRule } from './compartment-route-rule.contract';
import type { ContractSchema } from './schema.types';

export interface AppAccessScopeReference {
  scopeId: string;
  scopeType: AppAccessScopeType;
}

export interface AppAccessRouteAuthorizationState {
  accessMode: AppRouteAccessMode;
  routeScopeId: string;
  routeScopeType: AppAccessScopeType;
  scopeChain: AppAccessScopeReference[];
}

export interface AppAccessRouteState extends AppAccessRouteAuthorizationState {
  host: string;
  organizationId: string;
  organizationSlug: string;
  proxyRoutes: AppAccessProxyRouteState[];
  upstreamHost: string;
  upstreamPort: number;
}

export interface AppAccessProxyRouteAvailableTargetState extends AppAccessRouteAuthorizationState {
  upstreamHost: string;
  upstreamPort: number;
}

export interface AppAccessProxyRouteUnavailableTargetState extends AppAccessRouteAuthorizationState {
  upstreamHost: null;
  upstreamPort: null;
}

export type AppAccessProxyRouteTargetState =
  | AppAccessProxyRouteAvailableTargetState
  | AppAccessProxyRouteUnavailableTargetState;

export interface AppAccessProxyRouteState extends CompartmentRouteRule {
  target: AppAccessProxyRouteTargetState | null;
}

export interface AppAccessGrantState {
  principalId: string;
  permissions: PermissionKey[];
  scopeId: string;
  scopeType: AccessAssignmentScopeType;
}

export interface AppAccessSessionState {
  authSessionId: string;
  expiresAt: string;
  host: string;
  principalEmail: string;
  principalId: string;
  principalType: 'user';
}

export interface AppAccessStateSnapshot {
  onDemandTlsHosts: string[];
  grants: AppAccessGrantState[];
  compartmentUrl: string;
  routes: AppAccessRouteState[];
}

export interface AppAccessStateResponse {
  state: AppAccessStateSnapshot | null;
}

export interface EdgeInvalidateAppSessionsRequest {
  authSessionId: string;
}

const principalTypeSchema: ContractSchema<'user'> = z.enum(['user']);

const appAccessScopeReferenceSchema: ContractSchema<AppAccessScopeReference> = z
  .object({
    scopeId: z.string().min(1),
    scopeType: appAccessScopeTypeSchema,
  })
  .strict();

interface AppAccessRouteAuthorizationStateShape {
  accessMode: typeof appRouteAccessModeSchema;
  routeScopeId: z.ZodString;
  routeScopeType: typeof appAccessScopeTypeSchema;
  scopeChain: z.ZodArray<typeof appAccessScopeReferenceSchema, 'many'>;
}

const appAccessRouteAuthorizationStateShape: AppAccessRouteAuthorizationStateShape = {
  accessMode: appRouteAccessModeSchema,
  routeScopeId: z.string().min(1),
  routeScopeType: appAccessScopeTypeSchema,
  scopeChain: z.array(appAccessScopeReferenceSchema).min(1),
};

const appAccessProxyRouteAvailableTargetStateSchema: ContractSchema<AppAccessProxyRouteAvailableTargetState> = z
  .object({
    ...appAccessRouteAuthorizationStateShape,
    upstreamHost: z.string().min(1),
    upstreamPort: z.number().int().positive(),
  })
  .strict();

const appAccessProxyRouteUnavailableTargetStateSchema: ContractSchema<AppAccessProxyRouteUnavailableTargetState> = z
  .object({
    ...appAccessRouteAuthorizationStateShape,
    upstreamHost: z.null(),
    upstreamPort: z.null(),
  })
  .strict();

const appAccessProxyRouteTargetStateSchema: ContractSchema<AppAccessProxyRouteTargetState> = z.union([
  appAccessProxyRouteAvailableTargetStateSchema,
  appAccessProxyRouteUnavailableTargetStateSchema,
]);

const appAccessProxyRouteStateSchema: ContractSchema<AppAccessProxyRouteState> = z
  .object({
    ...createCompartmentRouteRuleShape(),
    target: appAccessProxyRouteTargetStateSchema.nullable(),
  })
  .strict()
  .superRefine(validateCompartmentRouteRule) as ContractSchema<AppAccessProxyRouteState>;

const appAccessRouteStateSchema: ContractSchema<AppAccessRouteState> = z
  .object({
    ...appAccessRouteAuthorizationStateShape,
    host: z.string().min(1),
    organizationId: z.string().min(1),
    organizationSlug: z.string().min(1),
    proxyRoutes: z.array(appAccessProxyRouteStateSchema),
    upstreamHost: z.string().min(1),
    upstreamPort: z.number().int().positive(),
  })
  .strict();

const appAccessGrantStateSchema: ContractSchema<AppAccessGrantState> = z
  .object({
    principalId: z.string().min(1),
    permissions: z.array(permissionKeySchema),
    scopeId: z.string().min(1),
    scopeType: accessAssignmentScopeTypeSchema,
  })
  .strict();

export const appAccessSessionStateSchema: ContractSchema<AppAccessSessionState> = z
  .object({
    authSessionId: z.string().min(1),
    expiresAt: z.string().datetime(),
    host: z.string().min(1),
    principalEmail: z.string().email(),
    principalId: z.string().min(1),
    principalType: principalTypeSchema,
  })
  .strict();

const appAccessStateSnapshotSchema: ContractSchema<AppAccessStateSnapshot> = z
  .object({
    onDemandTlsHosts: z.array(z.string().min(1)),
    grants: z.array(appAccessGrantStateSchema),
    compartmentUrl: z.string().url(),
    routes: z.array(appAccessRouteStateSchema),
  })
  .strict();

export const appAccessStateResponseSchema: ContractSchema<AppAccessStateResponse> = z
  .object({
    state: appAccessStateSnapshotSchema.nullable(),
  })
  .strict();

export const edgeInvalidateAppSessionsRequestSchema: ContractSchema<EdgeInvalidateAppSessionsRequest> = z
  .object({
    authSessionId: z.string().min(1),
  })
  .strict();
