import { logTailLineLimit, type ProductLogIngestEvent, type ResourceLogLine } from '@compartment/contracts';
import { immutableKubeName, kubeResourcePodNamePrefix } from '@compartment/utils';
import {
  insertDeploymentProductLogs,
  listDeploymentLogIdentities,
  listDeploymentProductLogLines,
  listResourceLogIdentities,
  listResourceLogProjectIds,
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

interface ResourceLogPodIdentity {
  podNamePrefix: string;
  resourceId: string;
}

interface ResourceLogProjectSnapshot {
  expiresAt: number;
  generation: number;
  projectIdByKubeNamespace: ReadonlyMap<string, string>;
}

const resourceLogProjectSnapshotTtlMs: number = 60_000;
let resourceLogProjectSnapshot: ResourceLogProjectSnapshot | undefined;
let resourceLogProjectSnapshotRefresh: Promise<ResourceLogProjectSnapshot> | undefined;
let resourceLogProjectSnapshotGeneration: number = 0;

export async function ingestDeploymentProductLogs(events: ProductLogIngestEvent[]): Promise<ProductLogIngestResult> {
  const identities: DeploymentLogIdentityRow[] = await listDeploymentLogIdentities(uniqueNamespaces(events));
  const resourceIdentityByNamespace: Map<string, ResourceLogPodIdentity[]> = await loadResourceLogIdentities(events);
  const deploymentByContainer: Map<string, string> = buildDeploymentIdentityMap(identities);
  const acceptedEvents: InsertProductLogInput[] = events.flatMap(
    (event: ProductLogIngestEvent): InsertProductLogInput[] => {
      if (event.containerName === 'resource') {
        const resourceId: string | undefined = resolveResourceIdentity(event, resourceIdentityByNamespace);
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

async function loadResourceLogIdentities(
  events: ProductLogIngestEvent[],
): Promise<Map<string, ResourceLogPodIdentity[]>> {
  const namespaces: Set<string> = new Set<string>(
    events.flatMap((event: ProductLogIngestEvent): string[] =>
      event.containerName === 'resource' ? [event.namespace] : [],
    ),
  );
  if (namespaces.size === 0) {
    return new Map<string, ResourceLogPodIdentity[]>();
  }
  const projectIds: string[] = await resolveResourceLogProjectIds(namespaces);
  return buildResourceLogIdentityMap(await listResourceLogIdentities(projectIds));
}

async function resolveResourceLogProjectIds(namespaces: ReadonlySet<string>): Promise<string[]> {
  const snapshot: ResourceLogProjectSnapshot = await loadResourceLogProjectSnapshot();
  return [...namespaces].flatMap((namespace: string): string[] => {
    const projectId: string | undefined = snapshot.projectIdByKubeNamespace.get(namespace);
    return projectId === undefined ? [] : [projectId];
  });
}

export function invalidateResourceLogProjectSnapshot(): void {
  resourceLogProjectSnapshotGeneration += 1;
  resourceLogProjectSnapshot = undefined;
}

async function loadResourceLogProjectSnapshot(): Promise<ResourceLogProjectSnapshot> {
  const now: number = Date.now();
  if (resourceLogProjectSnapshot !== undefined && resourceLogProjectSnapshot.expiresAt > now) {
    return resourceLogProjectSnapshot;
  }
  const generation: number = resourceLogProjectSnapshotGeneration;
  resourceLogProjectSnapshotRefresh ??= refreshResourceLogProjectSnapshot(now, generation);
  const snapshot: ResourceLogProjectSnapshot | undefined = await awaitResourceLogProjectSnapshotRefresh(
    resourceLogProjectSnapshotRefresh,
  );
  return snapshot ?? (await loadResourceLogProjectSnapshot());
}

async function awaitResourceLogProjectSnapshotRefresh(
  refresh: Promise<ResourceLogProjectSnapshot>,
): Promise<ResourceLogProjectSnapshot | undefined> {
  try {
    const snapshot: ResourceLogProjectSnapshot = await refresh;
    return snapshot.generation === resourceLogProjectSnapshotGeneration ? snapshot : undefined;
  } finally {
    clearResourceLogProjectSnapshotRefresh(refresh);
  }
}

function clearResourceLogProjectSnapshotRefresh(refresh: Promise<ResourceLogProjectSnapshot>): void {
  if (resourceLogProjectSnapshotRefresh === refresh) {
    resourceLogProjectSnapshotRefresh = undefined;
  }
}

async function refreshResourceLogProjectSnapshot(now: number, generation: number): Promise<ResourceLogProjectSnapshot> {
  const projectIds: string[] = await listResourceLogProjectIds();
  const snapshot: ResourceLogProjectSnapshot = {
    expiresAt: now + resourceLogProjectSnapshotTtlMs,
    generation,
    projectIdByKubeNamespace: new Map<string, string>(
      projectIds.map((projectId: string): [string, string] => [immutableKubeName('cpt', projectId), projectId]),
    ),
  };
  if (generation === resourceLogProjectSnapshotGeneration) {
    resourceLogProjectSnapshot = snapshot;
  }
  return snapshot;
}

function buildResourceLogIdentityMap(rows: ResourceLogIdentityRow[]): Map<string, ResourceLogPodIdentity[]> {
  const identityByNamespace: Map<string, ResourceLogPodIdentity[]> = new Map<string, ResourceLogPodIdentity[]>();
  for (const row of rows) {
    const namespace: string = immutableKubeName('cpt', row.namespaceId);
    const identities: ResourceLogPodIdentity[] = identityByNamespace.get(namespace) ?? [];
    identities.push({ podNamePrefix: kubeResourcePodNamePrefix(row.resourceId), resourceId: row.resourceId });
    identityByNamespace.set(namespace, identities);
  }
  return identityByNamespace;
}

function resolveResourceIdentity(
  event: ProductLogIngestEvent,
  identityByNamespace: ReadonlyMap<string, ResourceLogPodIdentity[]>,
): string | undefined {
  return identityByNamespace
    .get(event.namespace)
    ?.findLast((identity: ResourceLogPodIdentity): boolean => event.podName.startsWith(identity.podNamePrefix))
    ?.resourceId;
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
