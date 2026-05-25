import type {
  DeploymentPromotionStage,
  DeploymentRuntimeHealth,
  DeploymentRuntimeStatus,
  OperationStatus,
} from '@compartment/contracts';
import { buildPublicRouteHost } from '../lib/public-route-host';
import type {
  DeploymentJoinedRow,
  DeploymentRow,
  BuildArtifactRow,
  PersistedDeploymentJoinedRow,
  PersistedDeploymentRow,
  PersistedOperationRow,
} from './deployments.query.types';
import type { OperationRecord } from './operations.query.types';
import { toProjectServiceRow } from './project-service-row.mapper';
import { toBuildArtifactRow } from './deployments.query';

export function toDeploymentJoinedRow(row: PersistedDeploymentJoinedRow, routeBaseDomain: string): DeploymentJoinedRow {
  const artifact: BuildArtifactRow = toBuildArtifactRow(row.artifact);

  return {
    artifact,
    deployment: toJoinedDeploymentRow(row.deployment, row.routeSubdomain, routeBaseDomain),
    environment: row.environment,
    operation: toOperationRecord(row.operation),
    project: row.project,
    service: toProjectServiceRow(row.service),
  };
}

function toJoinedDeploymentRow(
  row: PersistedDeploymentRow,
  routeSubdomain: string | null,
  routeBaseDomain: string,
): DeploymentRow {
  return {
    ...row,
    accessMode: row.accessMode,
    health: row.health as DeploymentRuntimeHealth,
    promotionStage: row.promotionStage as DeploymentPromotionStage,
    routeBaseDomain: routeSubdomain === null ? null : routeBaseDomain,
    routeHost: routeSubdomain === null ? null : buildPublicRouteHost(routeBaseDomain, routeSubdomain),
    status: row.status as DeploymentRuntimeStatus,
  };
}

function toOperationRecord(row: PersistedOperationRow): OperationRecord {
  return {
    ...row,
    status: row.status as OperationStatus,
  };
}
