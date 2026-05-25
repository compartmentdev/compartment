import type {
  IssuePasswordResetResponse,
  SystemRestartResponse,
  SystemServicePublishedPort,
  SystemServiceSummary,
  SystemStatusResponse,
} from '@compartment/contracts';
import { quoteShellArgumentWhenNeeded } from '@compartment/utils';
import { readCliBuildInfo } from '../../cli-build-info';
import type { CliBuildInfo } from '../../cli-build-info.types';
import type { SelfHostedUpdateResult } from '../../update.types';
import { formatRollbackRetentionPolicy } from '../../services/rollback-retention-output.service';

type SystemStatusInstallCliChannel = 'latest' | 'main';

export function createSelfHostedUpdateResultMessage(result: SelfHostedUpdateResult): string {
  if (result.status === 'skipped') {
    return createSkippedSelfHostedUpdateResultMessage(result);
  }

  return `Updated self-hosted runtime using config ${result.configDir} and data ${result.dataDir}.
Version: ${result.currentVersion} -> ${result.targetVersion}.
Image source: ${result.imageSource}.
Backup saved to ${result.backupDir}.`;
}

function createSkippedSelfHostedUpdateResultMessage(result: SelfHostedUpdateResult): string {
  if (result.skipReason === 'downgrade-not-supported') {
    return `Skipped self-hosted runtime update using config ${result.configDir} and data ${result.dataDir}.
Requested version: ${result.targetVersion}.
Current version: ${result.currentVersion}.
Self-hosted downgrades are not supported. No changes were applied.
Requested image source: ${result.imageSource}.`;
  }

  return `Skipped self-hosted runtime update using config ${result.configDir} and data ${result.dataDir}.
Requested version and image source already match the current install.
Current version: ${result.currentVersion}.
Image source: ${result.imageSource}.`;
}

export function createSystemRestartResultMessage(result: SystemRestartResponse): string {
  return `Restarted self-hosted platform using config ${result.configDir} and data ${result.dataDir}.
Services: ${result.services.join(', ')}.
Restarted at: ${result.restartedAt}.`;
}

export function createSystemStatusResultMessage(result: SystemStatusResponse): string {
  const serviceStatusLines: string = result.services.map(createSystemServiceStatusLine).join('\n');

  return `Self-hosted platform status: ${result.overallStatus}.
Config dir: ${result.configDir}.
Data dir: ${result.dataDir}.
Console: ${result.domain.controlPlaneUrl}.
Login your CLI on this server:
  ${createLoginCliCommand(result)}
Docker namespace: ${result.dockerNamespace}.
Image source: ${result.imageSource}.
Rollback retention: ${formatRollbackRetentionPolicy(result.rollbackRetention)}.

${serviceStatusLines}`;
}

export function createIssuePasswordResetResultMessage(result: IssuePasswordResetResponse): string {
  return `Issued password reset for ${result.email}.
Reset URL: ${result.resetUrl}.
Expires at: ${result.expiresAt}.`;
}

function createLoginCliCommand(result: SystemStatusResponse): string {
  return `curl -fsSL https://compartment.dev/install.sh | sh -s -- --channel ${readSystemStatusInstallCliChannel()} --init-login --api-url ${quoteShellArgumentWhenNeeded(result.domain.cliApiUrl)}`;
}

function readSystemStatusInstallCliChannel(): SystemStatusInstallCliChannel {
  const buildInfo: CliBuildInfo = readCliBuildInfo();
  return buildInfo.distributionChannel === 'main' ? 'main' : 'latest';
}

function createSystemServiceStatusLine(service: SystemServiceSummary): string {
  const statusParts: string[] = [service.status];
  if (service.health !== null) {
    statusParts.push(`health ${service.health}`);
  }
  if (service.uptimeSeconds !== null) {
    statusParts.push(`uptime ${service.uptimeSeconds}s`);
  }

  return `${service.name}: ${statusParts.join(', ')}; image ${service.imageRef ?? 'n/a'}; ports ${formatPublishedPorts(service.publishedPorts)}`;
}

function formatPublishedPorts(ports: SystemServicePublishedPort[]): string {
  if (ports.length === 0) {
    return 'none';
  }

  return ports
    .map((port: SystemServicePublishedPort): string => {
      const hostAddress: string = port.hostIp === undefined ? String(port.hostPort) : `${port.hostIp}:${port.hostPort}`;
      return `${hostAddress}->${port.containerPort}`;
    })
    .join(', ');
}
