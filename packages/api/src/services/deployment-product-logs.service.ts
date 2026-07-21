import { logTailLineLimit, type ProductLogIngestEvent, type ResourceLogLine } from '@compartment/contracts';
import { immutableKubeName } from '@compartment/utils';
import {
  insertDeploymentProductLogs,
  listDeploymentLogIdentities,
  listDeploymentProductLogLines,
  listResourceLogIdentities,
  listResourceProductLogLines,
} from '../queries/deployment-product-logs.query';
import type {
  DeploymentLogIdentityRow,
  DeploymentProductLogLine,
  InsertDeploymentProductLogsResult,
  InsertProductLogInput,
  ResourceLogIdentityRow,
} from '../queries/deployment-product-logs.query.types';
import type { DeploymentJoinedRow } from '../queries/deployments.query.types';
import { listDeploymentLogWorkloadScopes } from '../queries/deployment-log-workload.query';
import type { DeploymentLogWorkloadScopeRow } from '../queries/deployment-log-workload.query.types';
import type { ProductLogIngestResult } from './deployment-product-logs.service.types';

const resourcePodNamePattern: RegExp = /^resource-res-([0-9a-f]{32})/;

export async function ingestDeploymentProductLogs(events: ProductLogIngestEvent[]): Promise<ProductLogIngestResult> {
  const identities: DeploymentLogIdentityRow[] = await listDeploymentLogIdentities(uniqueNamespaces(events));
  const resourceIds: string[] = resourceIdsFromEvents(events);
  const resourceIdentities: ResourceLogIdentityRow[] = await listResourceLogIdentities(resourceIds);
  const deploymentByContainer: Map<string, string> = buildDeploymentIdentityMap(identities);
  const acceptedEvents: InsertProductLogInput[] = events.flatMap(
    (event: ProductLogIngestEvent): InsertProductLogInput[] => {
      if (event.containerName === 'resource') {
        const resourceId: string | undefined = resolveResourceIdentity(event, resourceIdentities);
        return resourceId === undefined ? [] : [{ ...event, resourceId }];
      }
      const deploymentId: string | undefined = resolveDeploymentIdentity(event, deploymentByContainer);
      return deploymentId === undefined ? [] : [{ ...event, deploymentId }];
    },
  );
  const result: InsertDeploymentProductLogsResult = await insertDeploymentProductLogs(acceptedEvents);
  return buildProductLogIngestResult(events.length, acceptedEvents.length, result);
}

function buildProductLogIngestResult(
  eventCount: number,
  acceptedIdentityCount: number,
  result: InsertDeploymentProductLogsResult,
): ProductLogIngestResult {
  const deferred: number = acceptedIdentityCount - result.quotaAccepted;
  return {
    accepted: result.inserted,
    ...(deferred > 0 ? { deferred } : {}),
    duplicates: result.quotaAccepted - result.inserted,
    rejected: eventCount - result.quotaAccepted,
  };
}

function resolveResourceIdentity(event: ProductLogIngestEvent, rows: ResourceLogIdentityRow[]): string | undefined {
  const resourceId: string | undefined = extractResourceIdFromPodName(event.podName);
  if (resourceId === undefined) {
    return undefined;
  }
  return rows.findLast(
    (row: ResourceLogIdentityRow): boolean =>
      event.namespace === immutableKubeName('cpt', row.namespaceId) && row.resourceId === resourceId,
  )?.resourceId;
}

function resourceIdsFromEvents(events: ProductLogIngestEvent[]): string[] {
  return [
    ...new Set(
      events.flatMap((event: ProductLogIngestEvent): string[] => {
        if (event.containerName !== 'resource') {
          return [];
        }
        const resourceId: string | undefined = extractResourceIdFromPodName(event.podName);
        return resourceId === undefined ? [] : [resourceId];
      }),
    ),
  ];
}

function extractResourceIdFromPodName(podName: string): string | undefined {
  const match: RegExpExecArray | null = resourcePodNamePattern.exec(podName);
  return match?.[1] === undefined ? undefined : `res_${match[1]}`;
}

function resolveDeploymentIdentity(
  event: ProductLogIngestEvent,
  deploymentByContainer: ReadonlyMap<string, string>,
): string | undefined {
  return deploymentByContainer.get(identityKey(event.namespace, event.containerName));
}

export async function readStoredDeploymentProductLogs(
  deployments: DeploymentJoinedRow[],
  environmentName: string,
  since: Date | undefined,
  tailLines: number | undefined,
): Promise<DeploymentProductLogLine[]> {
  const deploymentById: Map<string, DeploymentJoinedRow> = new Map<string, DeploymentJoinedRow>(
    deployments.map((deployment: DeploymentJoinedRow): [string, DeploymentJoinedRow] => [
      deployment.deployment.id,
      deployment,
    ]),
  );
  const workloadScopes: DeploymentLogWorkloadScopeRow[] = await listDeploymentLogWorkloadScopes([
    ...deploymentById.keys(),
  ]);
  const currentDeploymentIdByLogDeploymentId: Map<string, string> = buildLogDeploymentScopeMap(workloadScopes);
  const lines: DeploymentProductLogLine[] = await listDeploymentProductLogLines({
    deploymentIds: [...currentDeploymentIdByLogDeploymentId.keys()],
    limit: tailLines ?? logTailLineLimit,
    since,
  });
  return mapStoredProductLogLines(lines, deploymentById, currentDeploymentIdByLogDeploymentId, environmentName);
}

export async function readStoredResourceProductLogs(
  resourceId: string,
  resourceName: string,
  since: Date | undefined,
  tailLines: number | undefined,
): Promise<ResourceLogLine[]> {
  const lines: ResourceLogLine[] = await listResourceProductLogLines({
    limit: tailLines ?? logTailLineLimit,
    resourceId,
    since,
  });
  return lines.map((line: ResourceLogLine): ResourceLogLine => ({ ...line, resourceName }));
}

function buildLogDeploymentScopeMap(scopes: DeploymentLogWorkloadScopeRow[]): Map<string, string> {
  return new Map<string, string>(
    scopes.map((scope: DeploymentLogWorkloadScopeRow): [string, string] => [
      scope.deploymentId,
      scope.currentDeploymentId,
    ]),
  );
}

function mapStoredProductLogLines(
  lines: DeploymentProductLogLine[],
  deploymentById: ReadonlyMap<string, DeploymentJoinedRow>,
  currentDeploymentIdByLogDeploymentId: ReadonlyMap<string, string>,
  environmentName: string,
): DeploymentProductLogLine[] {
  return lines.flatMap((line: DeploymentProductLogLine): DeploymentProductLogLine[] => {
    const currentDeploymentId: string | undefined = currentDeploymentIdByLogDeploymentId.get(line.deploymentId);
    const deployment: DeploymentJoinedRow | undefined =
      currentDeploymentId === undefined ? undefined : deploymentById.get(currentDeploymentId);
    return deployment === undefined ? [] : [{ ...line, environmentName, serviceName: deployment.service.name }];
  });
}

function uniqueNamespaces(events: ProductLogIngestEvent[]): string[] {
  return [...new Set(events.map((event: ProductLogIngestEvent): string => event.namespace))];
}

function buildDeploymentIdentityMap(rows: DeploymentLogIdentityRow[]): Map<string, string> {
  return new Map<string, string>(
    rows.map((row: DeploymentLogIdentityRow): [string, string] => [
      identityKey(row.namespace, immutableKubeName('app', row.deploymentId)),
      row.deploymentId,
    ]),
  );
}

function identityKey(namespace: string, containerName: string): string {
  return `${namespace}/${containerName}`;
}
