import type { ProjectRouteTargetSummary } from '@compartment/contracts/browser';
import type { BrowserProjectOpenTarget } from '../../services/browser-projects.service.types';

function toBrowserProjectOpenTarget(target: ProjectRouteTargetSummary): BrowserProjectOpenTarget {
  return {
    environmentName: target.environmentName,
    routeUrl: target.routeUrl,
    serviceName: target.serviceName,
  };
}

export function toBrowserProjectOpenTargets(targets: readonly ProjectRouteTargetSummary[]): BrowserProjectOpenTarget[] {
  return targets.map(toBrowserProjectOpenTarget);
}

export function areBrowserProjectOpenTargetsEqual(
  left: readonly BrowserProjectOpenTarget[],
  right: readonly ProjectRouteTargetSummary[],
): boolean {
  if (left.length !== right.length) {
    return false;
  }

  for (let index: number = 0; index < left.length; index += 1) {
    const leftTarget: BrowserProjectOpenTarget = left[index]!;
    const rightTarget: ProjectRouteTargetSummary = right[index]!;
    if (
      leftTarget.environmentName !== rightTarget.environmentName ||
      leftTarget.routeUrl !== rightTarget.routeUrl ||
      leftTarget.serviceName !== rightTarget.serviceName
    ) {
      return false;
    }
  }

  return true;
}
