import type { Command } from 'commander';
import { deploymentListLimit, type DeploymentListResponse } from '@compartment/contracts';
import { renderOutput } from '../../output/render';
import { createDeploymentListMessage } from '../../services/deployment-list-output.service';
import type { DeploymentListCommandInput, ProjectDeploymentListResult } from '../../services/deployment-movement.types';
import { listProjectDeployments } from '../../services/deployment-movement.service';
import { assertValidProjectName } from '../projects/project.command.helpers';
import type { CliCommandDependencies, DeploymentListCommandOptions } from '../command.types';
import { readOptionalPositiveIntegerOption } from '../list-pagination.command';
import { addRemoteOption, createRemoteAuthenticatedContext } from '../remote.command.helpers';

const deploymentListLimitErrorMessage: string = `--limit must be a positive integer up to ${deploymentListLimit}.`;

export function registerListDeploymentsCommand(program: Command, dependencies: CliCommandDependencies): void {
  addRemoteOption(
    program
      .command('list')
      .option('--project <name>')
      .option('--env <name>')
      .option('--service <name>')
      .option('--limit <count>', `positive integer up to ${deploymentListLimit}`)
      .option('--output <format>', 'text or json', 'text'),
  ).action(
    async (options: DeploymentListCommandOptions): Promise<void> =>
      await executeListDeploymentsCommand(dependencies, options),
  );
}

async function executeListDeploymentsCommand(
  dependencies: CliCommandDependencies,
  options: DeploymentListCommandOptions,
): Promise<void> {
  assertValidDeploymentListOptions(options);
  const input: DeploymentListCommandInput = createDeploymentListInput(options);
  const result: ProjectDeploymentListResult = await listProjectDeployments(
    await createRemoteAuthenticatedContext(options),
    input,
  );
  const response: DeploymentListResponse = result.response;

  renderOutput(
    dependencies.io,
    options.output,
    response,
    createDeploymentListMessage(response, result.environmentName),
  );
}

function assertValidDeploymentListOptions(options: DeploymentListCommandOptions): void {
  if (options.project !== undefined) {
    assertValidProjectName(options.project);
  }
}

function createDeploymentListInput(options: DeploymentListCommandOptions): DeploymentListCommandInput {
  return {
    cwd: process.cwd(),
    environmentName: options.env,
    limit: readOptionalPositiveIntegerOption(options.limit, '--limit', {
      errorMessage: deploymentListLimitErrorMessage,
      max: deploymentListLimit,
    }),
    projectName: options.project,
    serviceName: options.service,
  };
}
