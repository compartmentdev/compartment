import type {
  DeploymentPromotionStage,
  DeploymentRuntimeHealth,
  DeploymentRuntimeStatus,
} from '@compartment/contracts';
import type { DeploymentRow, PersistedDeploymentRow } from './deployments.query.types';

export function toDeploymentRow(row: PersistedDeploymentRow): DeploymentRow {
  return {
    ...row,
    accessMode: row.accessMode,
    drainDeadlineAt: row.drainDeadlineAt,
    drainingContainerId: row.drainingContainerId,
    drainingDeploymentId: row.drainingDeploymentId,
    drainingNodeId: row.drainingNodeId,
    health: row.health as DeploymentRuntimeHealth,
    promotionStage: row.promotionStage as DeploymentPromotionStage,
    resolvedReadinessJson: row.resolvedReadinessJson,
    routeBaseDomain: null,
    routeHost: null,
    status: row.status as DeploymentRuntimeStatus,
    upstreamHost: row.upstreamHost,
  };
}
