import { listProvisionedProjectNamespaceRows } from '../queries/pod-metric-namespaces.query';
import type { ProvisionedProjectNamespaceRow } from '../queries/pod-metric-namespaces.query.types';
import type { PodMetricNamespaceScope } from './pod-metrics-namespace.service.types';

export async function readPodMetricNamespaceScope(): Promise<PodMetricNamespaceScope> {
  const rows: ProvisionedProjectNamespaceRow[] = await listProvisionedProjectNamespaceRows();
  return { namespaceIds: rows.map((row: ProvisionedProjectNamespaceRow): string => row.projectId) };
}
