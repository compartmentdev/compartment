import type { Command } from 'commander';
import type { DeploymentRunLogLine, DeploymentRunLogsResponse } from '@compartment/contracts';
import { getProjectDeploymentRunLogs } from '../../services/deployment-run-logs.service';
import type { DeploymentLogsCommandInput, DeploymentLogsCommandInputBase } from '../../services/deployments.types';
import { createDeploymentRunLogsResultMessage } from '../../services/deployment-run-logs-output.service';
import type { AuthenticatedContext } from '../../services/context.types';
import type { CliCommandDependencies, DeploymentLogsCommandOptions } from '../command.types';
import { addRemoteOption } from '../remote.command.helpers';
import { executeFollowableLogsCommand } from '../logs/followable-logs-command.service';
import { normalizeLogsFollowTimestamp } from '../logs/logs.command.timestamp';

export function registerDeploymentLogsCommand(program: Command, dependencies: CliCommandDependencies): void {
  addRemoteOption(
    program
      .command('logs')
      .option('--run <id>')
      .option('--project <name>')
      .option('--env <name>')
      .option('--service <name>')
      .option('--follow', 'poll for new log lines and keep streaming them')
      .option('--verbose', 'show deployment details above log lines')
      .option('--output <format>', 'text or json', 'text'),
  ).action(
    async (options: DeploymentLogsCommandOptions): Promise<void> =>
      await executeDeploymentLogsCommand(dependencies, options),
  );
}

async function executeDeploymentLogsCommand(
  dependencies: CliCommandDependencies,
  options: DeploymentLogsCommandOptions,
): Promise<void> {
  await executeFollowableLogsCommand<DeploymentRunLogsResponse, DeploymentRunLogLine, DeploymentLogsCommandOptions>({
    createFollowLineSignature,
    dependencies,
    options,
    readLines: (response: DeploymentRunLogsResponse): DeploymentRunLogLine[] => response.lines,
    readResponse: readDeploymentRunLogs,
    readTimestamp: (line: DeploymentRunLogLine): string => normalizeLogsFollowTimestamp(line.timestamp),
    renderInitial: (response: DeploymentRunLogsResponse, commandOptions: DeploymentLogsCommandOptions): string =>
      createDeploymentRunLogsResultMessage(response, {
        verbose: commandOptions.verbose,
      }),
    renderLines: (response: DeploymentRunLogsResponse, lines: DeploymentRunLogLine[]): string =>
      createDeploymentRunLogsResultMessage({ ...response, lines }, { verbose: false }),
  });
}

async function readDeploymentRunLogs(
  context: AuthenticatedContext,
  options: DeploymentLogsCommandOptions,
  since: string | undefined = undefined,
): Promise<DeploymentRunLogsResponse> {
  return await getProjectDeploymentRunLogs(context, createDeploymentLogsCommandInput(options, since));
}

function createFollowLineSignature(line: DeploymentRunLogLine): string {
  return [
    line.deploymentId ?? '',
    line.serviceName ?? '',
    line.stream,
    line.level,
    line.stepKey,
    normalizeLogsFollowTimestamp(line.timestamp),
    line.message,
  ].join('\u0000');
}

function createDeploymentLogsCommandInput(
  options: DeploymentLogsCommandOptions,
  since: string | undefined,
): DeploymentLogsCommandInput {
  const commonInput: DeploymentLogsCommandInputBase = {
    cwd: process.cwd(),
    environmentName: options.env,
    projectName: options.project,
    serviceName: options.service,
    since,
  };
  if (options.run === undefined) {
    return {
      ...commonInput,
      selector: 'latest',
    };
  }

  return {
    ...commonInput,
    deploymentRunId: options.run,
    selector: 'run',
  };
}
