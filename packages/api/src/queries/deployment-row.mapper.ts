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
    health: row.health as DeploymentRuntimeHealth,
    promotionStage: row.promotionStage as DeploymentPromotionStage,
    routeBaseDomain: null,
    routeHost: null,
    status: row.status as DeploymentRuntimeStatus,
  };
}
