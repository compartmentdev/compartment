import type { Command } from 'commander';
import type { DeploymentLogLine, DeploymentLogsResponse } from '@compartment/contracts';
import { getProjectDeploymentLogs } from '../../services/deployments.service';
import type { AuthenticatedContext } from '../../services/context.types';
import type { CliCommandDependencies, LogsCommandOptions } from '../command.types';
import { createLogsResultMessage } from '../deployments/deployment.command.output';
import { addRemoteOption } from '../remote.command.helpers';
import { executeFollowableLogsCommand } from './followable-logs-command.service';
import { normalizeLogsFollowTimestamp } from './logs.command.timestamp';

export function registerLogsCommand(program: Command, dependencies: CliCommandDependencies): void {
  addRemoteOption(
    program
      .command('logs')
      .option('--service <name>')
      .option('--env <name>')
      .option('--project <name>')
      .option('--follow', 'poll for new log lines and keep streaming them')
      .option('--verbose', 'show deployment details above log lines')
      .option('--output <format>', 'text or json', 'text'),
  ).action(async (options: LogsCommandOptions): Promise<void> => await executeLogsCommand(dependencies, options));
}

async function executeLogsCommand(dependencies: CliCommandDependencies, options: LogsCommandOptions): Promise<void> {
  await executeFollowableLogsCommand<DeploymentLogsResponse, DeploymentLogLine, LogsCommandOptions>({
    createFollowLineSignature,
    dependencies,
    options,
    readLines: (response: DeploymentLogsResponse): DeploymentLogLine[] => response.lines,
    readResponse: readDeploymentLogs,
    readTimestamp: (line: DeploymentLogLine): string => normalizeLogsFollowTimestamp(line.timestamp),
    renderInitial: (response: DeploymentLogsResponse, commandOptions: LogsCommandOptions): string =>
      createLogsResultMessage(response, {
        verbose: commandOptions.verbose,
      }),
    renderLines: (response: DeploymentLogsResponse, lines: DeploymentLogLine[]): string =>
      createLogsResultMessage({ ...response, lines }, { showSelectionNotice: false, verbose: false }),
  });
}

async function readDeploymentLogs(
  context: AuthenticatedContext,
  options: LogsCommandOptions,
  since: string | undefined = undefined,
): Promise<DeploymentLogsResponse> {
  return await getProjectDeploymentLogs(context, {
    cwd: process.cwd(),
    environmentName: options.env,
    projectName: options.project,
    serviceName: options.service,
    since,
  });
}

function createFollowLineSignature(line: DeploymentLogLine): string {
  return [
    line.deploymentId,
    line.environmentName,
    line.serviceName,
    line.stream,
    normalizeLogsFollowTimestamp(line.timestamp),
    line.message,
  ].join('\u0000');
}
