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

export async function ingestDeploymentProductLogs(events: ProductLogIngestEvent[]): Promise<ProductLogIngestResult> {
  const identities: DeploymentLogIdentityRow[] = await listDeploymentLogIdentities(uniqueNamespaces(events));
  const resourceIdentities: ResourceLogIdentityRow[] = events.some(
    (event: ProductLogIngestEvent): boolean => event.containerName === 'resource',
  )
    ? await listResourceLogIdentities()
    : [];
  const deploymentByContainer: Map<string, string> = buildDeploymentIdentityMap(identities);
  const acceptedEvents: InsertProductLogInput[] = events.flatMap(
    (event: ProductLogIngestEvent): InsertProductLogInput[] => {
      if (event.containerName === 'resource') {
        const resourceId: string | undefined = resolveResourceIdentity(event, resourceIdentities);
        return resourceId === undefined ? [] : [{ ...event, resourceId }];
      }
      const deploymentId: string | undefined = resolveDeploymentIdentity(event, identities, deploymentByContainer);
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
  return rows.findLast(
    (row: ResourceLogIdentityRow): boolean =>
      event.namespace === immutableKubeName('cpt', row.namespaceId) &&
      event.podName.startsWith(`${immutableKubeName('resource', row.resourceId)}-`),
  )?.resourceId;
}

function resolveDeploymentIdentity(
  event: ProductLogIngestEvent,
  rows: DeploymentLogIdentityRow[],
  deploymentByContainer: ReadonlyMap<string, string>,
): string | undefined {
  const direct: string | undefined = deploymentByContainer.get(identityKey(event.namespace, event.containerName));
  if (direct !== undefined || event.containerName !== 'app') {
    return direct;
  }
  const occurredAt: number = Date.parse(event.timestamp);
  return rows.findLast(
    (row: DeploymentLogIdentityRow): boolean =>
      row.createdAt.getTime() <= occurredAt &&
      row.namespace === event.namespace &&
      event.podName.startsWith(`${row.deploymentName}-`),
  )?.deploymentId;
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
