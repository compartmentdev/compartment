import { createHash } from 'node:crypto';
import {
  compartmentSystemDomainStatusPathname,
  compartmentSystemDomainStatusRefreshPathname,
  systemDomainMutationResponseSchema,
  systemDomainStatusResponseSchema,
  type SystemDomainMutationResponse,
  type SystemDomainStatusResponse,
} from '@compartment/contracts';
import type { JsonValue } from '@compartment/utils';
import { readRequiredSelfHostedEnvironmentValue } from './self-hosted-env-file';
import {
  createSystemCommandContext,
  readSystemClientConfig,
  readSystemEnvironmentValues,
  type SystemCommandContext,
} from './system-api';
import { requestSystemDomainApi } from './system-domain-client';
import type { SystemDomainClientConfig } from './system-domain-client.types';

export type SystemDomainCommandContext = SystemCommandContext;

export interface SystemDomainAttachCommandContext extends SystemDomainCommandContext {
  customTlsDirectory: string;
}

export async function createSystemDomainCommandContext(): Promise<SystemDomainCommandContext> {
  return await createSystemCommandContext();
}

export async function createSystemDomainAttachCommandContext(): Promise<SystemDomainAttachCommandContext> {
  const environmentValues: Record<string, string> = await readSystemEnvironmentValues();

  return {
    client: readSystemClientConfig(environmentValues),
    customTlsDirectory: readRequiredSelfHostedEnvironmentValue(environmentValues, 'COMPARTMENT_CUSTOM_TLS_DIR'),
  };
}

export async function getSystemDomainStatus(client: SystemDomainClientConfig): Promise<SystemDomainStatusResponse> {
  return await requestSystemDomainApi(client, {
    method: 'GET',
    parse: (value: JsonValue | null): SystemDomainStatusResponse => systemDomainStatusResponseSchema.parse(value),
    path: compartmentSystemDomainStatusPathname,
  });
}

export async function postSystemDomainStatusRefresh(
  client: SystemDomainClientConfig,
): Promise<SystemDomainStatusResponse> {
  return await requestSystemDomainApi(client, {
    method: 'POST',
    parse: (value: JsonValue | null): SystemDomainStatusResponse => systemDomainStatusResponseSchema.parse(value),
    path: compartmentSystemDomainStatusRefreshPathname,
  });
}

export async function postSystemDomainMutation(
  client: SystemDomainClientConfig,
  path: string,
  idempotencyVersion: number,
  body: object,
  idempotencySeed?: string,
): Promise<SystemDomainMutationResponse> {
  return await requestSystemDomainApi(client, {
    body,
    idempotencyKey: buildSystemDomainIdempotencyKey(path, idempotencyVersion, body, idempotencySeed),
    method: 'POST',
    parse: (value: JsonValue | null): SystemDomainMutationResponse => systemDomainMutationResponseSchema.parse(value),
    path,
  });
}

function buildSystemDomainIdempotencyKey(
  path: string,
  idempotencyVersion: number,
  body: object,
  idempotencySeed?: string,
): string {
  const requestFingerprint: string = createHash('sha256')
    .update(
      JSON.stringify({
        body,
        path,
        ...(idempotencySeed === undefined ? {} : { seed: idempotencySeed }),
        version: idempotencyVersion,
      }),
    )
    .digest('hex')
    .slice(0, 24);

  return `domain-${idempotencyVersion.toString()}-${requestFingerprint}`;
}
