import type { DeploymentInspectResponse, DeploymentInspectTarget, CompartmentRouteRule } from '@compartment/contracts';
import { formatDeploymentBuildPackageList, formatDeploymentReadiness } from './deployment-output-format.service';
import { readDisplayedDeployments } from './deployment-displayed-deployments.service';
import { formatDeploymentLabelTag } from './deployment-label-output.service';
import { buildNoDeploymentsFoundMessage } from './deployment-empty-message.service';

export function createInspectResultMessage(response: DeploymentInspectResponse, verbose: boolean | undefined): string {
  const deployments: DeploymentInspectTarget[] = readDisplayedDeployments(response);
  if (deployments.length === 0) {
    return buildNoDeploymentsFoundMessage(response.project.name, response.environment.name);
  }
  if (deployments.length > 1) {
    return buildAggregateInspectMessage(response, deployments, verbose);
  }

  return buildSingleInspectMessage(response, deployments[0]!, verbose);
}

function buildAggregateInspectMessage(
  response: DeploymentInspectResponse,
  deployments: DeploymentInspectTarget[],
  verbose: boolean | undefined,
): string {
  const header: string = `Inspect ${response.project.name}/${response.environment.name}: ${deployments
    .map(
      (deployment: DeploymentInspectTarget): string =>
        `${deployment.serviceName}${formatDeploymentLabelTag(deployment.label)}=${deployment.status} (${deployment.promotionStage})`,
    )
    .join('; ')}.`;
  if (verbose !== true) {
    return header;
  }

  return renderInspectMessage(
    header,
    buildMultiDeploymentInspectDetails(deployments, response.sensitiveTopologyVisible),
  );
}

function buildSingleInspectMessage(
  response: DeploymentInspectResponse,
  deployment: DeploymentInspectTarget,
  verbose: boolean | undefined,
): string {
  const header: string = `Inspect ${response.project.name}/${response.environment.name} ${deployment.serviceName}${formatDeploymentLabelTag(
    deployment.label,
  )}: ${deployment.status} (${deployment.promotionStage}).`;
  if (verbose !== true) {
    return header;
  }

  return renderInspectMessage(header, buildInspectDetails(deployment, response.sensitiveTopologyVisible));
}

function buildMultiDeploymentInspectDetails(
  deployments: DeploymentInspectTarget[],
  sensitiveTopologyVisible: boolean,
): string[] {
  return deployments.flatMap((deployment: DeploymentInspectTarget): string[] =>
    buildServiceInspectDetails(deployment, sensitiveTopologyVisible),
  );
}

function buildServiceInspectDetails(deployment: DeploymentInspectTarget, sensitiveTopologyVisible: boolean): string[] {
  return buildInspectDetails(deployment, sensitiveTopologyVisible).map(
    (line: string): string => `[${deployment.serviceName}] ${line}`,
  );
}

function buildInspectDetails(deployment: DeploymentInspectTarget, sensitiveTopologyVisible: boolean): string[] {
  return [
    `Deployment: ${deployment.id}`,
    `Label: ${deployment.label ?? 'n/a'}`,
    `Route Host: ${deployment.routeHost ?? 'n/a'}`,
    `Service Host: ${formatSensitiveValue(deployment.runtime?.serviceHost ?? null, sensitiveTopologyVisible)}`,
    `Service Port: ${formatSensitiveValue(deployment.runtime?.servicePort.toString() ?? null, sensitiveTopologyVisible)}`,
    `Routes: ${formatRoutes(deployment)}`,
    `Runtime Image: ${deployment.runtime?.imageRef ?? 'n/a'}`,
    `Readiness: ${formatDeploymentReadiness(deployment.readiness)}`,
    `Build Packages: ${formatDeploymentBuildPackageList(deployment.build.packages.build)}`,
    `Runtime Packages: ${formatDeploymentBuildPackageList(deployment.build.packages.runtime)}`,
  ];
}

function formatSensitiveValue(value: string | null, sensitiveTopologyVisible: boolean): string {
  if (!sensitiveTopologyVisible) {
    return 'redacted';
  }
  if (value !== null) {
    return value;
  }

  return 'n/a';
}

function renderInspectMessage(header: string, detailLines: readonly string[]): string {
  return `${header}\n${detailLines.join('\n')}`;
}

function formatRoutes(deployment: DeploymentInspectTarget): string {
  if (deployment.routes.length === 0) {
    return 'n/a';
  }

  return deployment.routes
    .map((route: CompartmentRouteRule): string => {
      const methods: string = route.methods?.join(',') ?? '*';
      const transform: string = readRouteTransform(route);

      return `${methods} ${route.path} -> ${route.to} (${transform})`;
    })
    .join('; ');
}

function readRouteTransform(route: CompartmentRouteRule): string {
  if (route.rewrite !== undefined) {
    return `rewrite=${route.rewrite}`;
  }
  if (route.replacePrefix !== undefined) {
    return `replacePrefix=${route.replacePrefix}`;
  }
  if (route.stripPrefix !== undefined) {
    return `stripPrefix=${route.stripPrefix}`;
  }

  return 'pass-through';
}
