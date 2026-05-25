import {
  isDeploymentRollbackAvailable,
  type DeploymentPromotionStage,
  type DeploymentRuntimeHealth,
  type DeploymentRuntimeStatus,
  type DeploymentReusableImageState,
} from '@compartment/contracts';
import type { ApiConfig } from '../../config';
import { getApiConfig } from '../../runtime/runtime-access';
import { buildPublicRouteUrl } from '../../services/public-hosts.service';
import { readDeploymentReusableImageState } from '../../services/deployment-reusable-image-state.service';
import type { DeploymentSummaryInput } from '../../services/presenter.types';
import { toNullableIsoString } from '../presenters/date.presenter';

interface DeploymentBaseSummary {
  completedAt: string | null;
  createdAt: string;
  failureMessage: string | null;
  health: DeploymentRuntimeHealth;
  id: string;
  isActive: boolean;
  label: string | null;
  promotionStage: DeploymentPromotionStage;
  reusableImageState: DeploymentReusableImageState;
  rollbackAvailable: boolean;
  routeUrl: string | null;
  serviceName: string;
  status: DeploymentRuntimeStatus;
}

export function buildDeploymentBaseSummary(parts: DeploymentSummaryInput): DeploymentBaseSummary {
  const reusableImageState: DeploymentReusableImageState = readDeploymentReusableImageState(parts.artifact);

  return {
    completedAt: toNullableIsoString(parts.deployment.completedAt),
    createdAt: parts.deployment.createdAt.toISOString(),
    failureMessage: parts.deployment.failureMessage,
    health: parts.deployment.health,
    id: parts.deployment.id,
    isActive: parts.deployment.isActive,
    label: parts.deployment.label,
    promotionStage: parts.deployment.promotionStage,
    reusableImageState,
    rollbackAvailable: isDeploymentRollbackAvailable({
      isActive: parts.deployment.isActive,
      reusableImageState,
      status: parts.deployment.status,
    }),
    routeUrl: buildDeploymentRouteUrl(parts),
    serviceName: parts.service.name,
    status: parts.deployment.status,
  };
}

function buildDeploymentRouteUrl(parts: DeploymentSummaryInput): string | null {
  const routeHost: string | null = readVisibleDeploymentRouteHost(parts);
  const routeBaseDomain: string | null = readVisibleDeploymentRouteBaseDomain(parts);

  if (routeHost === null || routeBaseDomain === null) {
    return null;
  }

  const config: ApiConfig = getApiConfig();

  return buildPublicRouteUrl(
    {
      host: routeHost,
    },
    config,
  );
}

export function readVisibleDeploymentRouteHost(parts: DeploymentSummaryInput): string | null {
  return isPublishedDeployment(parts) ? parts.deployment.routeHost : null;
}

function readVisibleDeploymentRouteBaseDomain(parts: DeploymentSummaryInput): string | null {
  return isPublishedDeployment(parts) ? parts.deployment.routeBaseDomain : null;
}

function isPublishedDeployment(parts: DeploymentSummaryInput): boolean {
  return (
    parts.deployment.completedAt !== null &&
    (parts.deployment.status === 'succeeded' || parts.deployment.status === 'stopped')
  );
}
