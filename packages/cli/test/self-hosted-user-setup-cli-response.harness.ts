import { expect } from 'vitest';
import {
  deploymentMetricsSnapshotSchema,
  deploymentStatusResponseSchema,
  type AuditEventListResponse,
  type AuditEventSummary,
  type DeploymentMetricsSnapshot,
  type DeploymentInspectResponse,
  type DeploymentInspectTarget,
  type DeploymentReadSummary,
  type DeploymentStatusResponse,
  type InviteUserResponse,
  type ResourceSummary,
} from '@compartment/contracts';
import type { JsonValue } from '@compartment/utils';
import { readJsonRecord } from '../src/json.helpers';
import type { SelfHostedUserSetupJsonParser } from './self-hosted-user-setup-command.harness';

export interface SelfHostedDeployCommandResponse extends DeploymentStatusResponse {
  readonly resources: ResourceSummary[];
}

interface DeploymentStatusCommandResponse extends DeploymentStatusResponse {
  readonly metrics: DeploymentMetricsSnapshot;
}

class DeploymentStatusCommandResponseParser implements SelfHostedUserSetupJsonParser<DeploymentStatusCommandResponse> {
  parse(input: JsonValue): DeploymentStatusCommandResponse {
    const payload: Record<string, JsonValue | undefined> = readJsonRecord(input);
    const { metrics, ...statusPayload } = payload;

    return {
      ...deploymentStatusResponseSchema.parse(statusPayload),
      metrics: deploymentMetricsSnapshotSchema.parse(metrics),
    };
  }
}

export const deploymentStatusCommandResponseParser: SelfHostedUserSetupJsonParser<DeploymentStatusCommandResponse> =
  new DeploymentStatusCommandResponseParser();

type ParsedDeployResource = JsonValue & ResourceSummary;

class SelfHostedDeployCommandResponseParser implements SelfHostedUserSetupJsonParser<SelfHostedDeployCommandResponse> {
  parse(input: JsonValue): SelfHostedDeployCommandResponse {
    const payload: Record<string, JsonValue | undefined> = readJsonRecord(input);
    const { resources, ...statusPayload } = payload;

    return {
      ...deploymentStatusResponseSchema.parse(statusPayload),
      resources: parseDeployResources(resources),
    };
  }
}

export const deployCommandResponseParser: SelfHostedUserSetupJsonParser<SelfHostedDeployCommandResponse> =
  new SelfHostedDeployCommandResponseParser();

export function requireActivationToken(response: InviteUserResponse): string {
  const token: string | undefined = response.invitation?.bootstrapToken;
  if (token === undefined) {
    throw new Error('Expected invitation bootstrap token.');
  }

  return token;
}

export function requireRouteUrl(response: DeploymentStatusResponse, serviceName: string): string {
  const deployment: DeploymentReadSummary = requireSingleActiveDeployment(response, serviceName);
  if (deployment.routeUrl === null) {
    throw new Error(`Expected ${serviceName} to expose a route URL.`);
  }

  return deployment.routeUrl;
}

export function requireSingleActiveDeployment(
  response: DeploymentStatusResponse,
  serviceName: string,
): DeploymentReadSummary {
  const deployments: DeploymentReadSummary[] = response.activeDeployments.filter(
    (deployment: DeploymentReadSummary): boolean => deployment.serviceName === serviceName,
  );
  if (deployments.length !== 1 || deployments[0] === undefined) {
    throw new Error(`Expected one active deployment for ${serviceName}.`);
  }

  return deployments[0];
}

export function requireSingleInspectedActiveDeployment(
  response: DeploymentInspectResponse,
  serviceName: string,
): DeploymentInspectTarget {
  const deployments: DeploymentInspectTarget[] = response.activeDeployments.filter(
    (deployment: DeploymentInspectTarget): boolean => deployment.serviceName === serviceName,
  );
  if (deployments.length !== 1 || deployments[0] === undefined) {
    throw new Error(`Expected one inspected active deployment for ${serviceName}.`);
  }

  return deployments[0];
}

export function expectAuditEvents(response: AuditEventListResponse, eventTypes: readonly string[]): void {
  const actualEventTypes: Set<string> = new Set<string>(
    response.events.map((event: AuditEventSummary): string => event.eventType),
  );
  const missingEventTypes: string[] = eventTypes.filter(
    (eventType: string): boolean => !actualEventTypes.has(eventType),
  );
  expect(
    missingEventTypes,
    `Missing audit event types: ${missingEventTypes.join(', ')}. Actual event types: ${[...actualEventTypes].join(', ')}.`,
  ).toEqual([]);
}

export function readAuditExportEventTypes(stdout: string): string[] {
  return stdout
    .trim()
    .split('\n')
    .filter((line: string): boolean => line.length > 0)
    .map(readAuditExportEventType);
}

function parseDeployResources(value: JsonValue | undefined): ResourceSummary[] {
  if (!Array.isArray(value)) {
    throw new Error('Expected deploy response resources.');
  }

  return value as ParsedDeployResource[];
}

function readAuditExportEventType(line: string): string {
  const eventType: JsonValue | undefined = readJsonRecord(JSON.parse(line) as JsonValue).eventType;
  if (typeof eventType !== 'string') {
    throw new Error('Expected audit export eventType.');
  }

  return eventType;
}
