import type { Command } from 'commander';
import type { DeploymentStatusResponse } from '@compartment/contracts';
import { renderOutput } from '../../output/render';
import { getProjectDeploymentStatus } from '../../services/deployments.service';
import type { StatusCommandInput } from '../../services/deployments.types';
import { assertValidProjectName } from '../projects/project.command.helpers';
import type { CliCommandDependencies, EnvironmentCommandOptions } from '../command.types';
import { addRemoteOption, createRemoteAuthenticatedContext } from '../remote.command.helpers';
import { createStatusResultMessage } from '../deployments/deployment.command.output';

export function registerStatusCommand(program: Command, dependencies: CliCommandDependencies): void {
  addRemoteOption(
    program
      .command('status')
      .option('--env <name>')
      .option('--project <name>')
      .option('--service <name>')
      .option('--verbose', 'show detailed deployment fields')
      .option('--output <format>', 'text or json', 'text'),
  ).action(
    async (options: EnvironmentCommandOptions): Promise<void> => await executeStatusCommand(dependencies, options),
  );
}

async function executeStatusCommand(
  dependencies: CliCommandDependencies,
  options: EnvironmentCommandOptions,
): Promise<void> {
  assertValidStatusOptions(options);
  const response: DeploymentStatusResponse = await getProjectDeploymentStatus(
    await createRemoteAuthenticatedContext(options),
    createStatusInput(options),
  );

  renderOutput(
    dependencies.io,
    options.output,
    response,
    createStatusResultMessage(response, {
      verbose: options.verbose,
    }),
  );
}

function assertValidStatusOptions(options: EnvironmentCommandOptions): void {
  if (options.project !== undefined) {
    assertValidProjectName(options.project);
  }
}

function createStatusInput(options: EnvironmentCommandOptions): StatusCommandInput {
  return {
    cwd: process.cwd(),
    environmentName: options.env,
    projectName: options.project,
    serviceName: options.service,
  };
}
