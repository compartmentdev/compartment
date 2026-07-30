import { z } from 'zod';
import { appAccessFlowStateSchema } from './app-access-protocol.contract';
import { appAccessSessionStateSchema, type AppAccessSessionState } from './app-access-state.contract';
import { safeRelativePathSchema } from './safe-relative-path.contract';
import type { ContractSchema } from './schema.types';

export interface AppAccessExchangeRequest {
  code: string;
  host: string;
  state: string;
}

export interface AppAccessExchangeResponse {
  appSessionToken: string;
  redirectPath: string;
  session: AppAccessSessionState;
}

export interface AppAccessLogoutRequest {
  appSessionToken: string | null;
}

export interface AppAccessSessionResolveRequest {
  appSessionToken: string;
}

export interface AppAccessSessionResolveResponse {
  session: AppAccessSessionState | null;
}

export const appAccessExchangeRequestSchema: ContractSchema<AppAccessExchangeRequest> = z
  .object({
    code: z.string().min(1),
    host: z.string().min(1),
    state: appAccessFlowStateSchema,
  })
  .strict();

export const appAccessExchangeResponseSchema: ContractSchema<AppAccessExchangeResponse> = z
  .object({
    appSessionToken: z.string().min(1),
    redirectPath: safeRelativePathSchema,
    session: appAccessSessionStateSchema,
  })
  .strict();

export const appAccessLogoutRequestSchema: ContractSchema<AppAccessLogoutRequest> = z
  .object({
    appSessionToken: z.string().min(1).nullable(),
  })
  .strict();

export const appAccessSessionResolveRequestSchema: ContractSchema<AppAccessSessionResolveRequest> = z
  .object({
    appSessionToken: z.string().min(1),
  })
  .strict();

export const appAccessSessionResolveResponseSchema: ContractSchema<AppAccessSessionResolveResponse> = z
  .object({
    session: appAccessSessionStateSchema.nullable(),
  })
  .strict();
