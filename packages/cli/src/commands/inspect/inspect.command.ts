import type { Command } from 'commander';
import type { DeploymentInspectResponse } from '@compartment/contracts';
import { renderOutput } from '../../output/render';
import { createInspectResultMessage } from '../../services/deployment-inspect-output.service';
import { getProjectDeploymentInspect } from '../../services/deployments.service';
import type { InspectCommandInput } from '../../services/deployments.types';
import { assertValidProjectName } from '../projects/project.command.helpers';
import type { CliCommandDependencies, InspectCommandOptions } from '../command.types';
import { addRemoteOption, createRemoteAuthenticatedContext } from '../remote.command.helpers';

export function registerInspectCommand(program: Command, dependencies: CliCommandDependencies): void {
  addRemoteOption(
    program
      .command('inspect')
      .option('--env <name>')
      .option('--project <name>')
      .option('--service <name>')
      .option('--verbose', 'show inspect details')
      .option('--output <format>', 'text or json', 'text'),
  ).action(async (options: InspectCommandOptions): Promise<void> => await executeInspectCommand(dependencies, options));
}

async function executeInspectCommand(
  dependencies: CliCommandDependencies,
  options: InspectCommandOptions,
): Promise<void> {
  if (options.project !== undefined) {
    assertValidProjectName(options.project);
  }

  const response: DeploymentInspectResponse = await getProjectDeploymentInspect(
    await createRemoteAuthenticatedContext(options),
    createInspectInput(options),
  );

  renderOutput(dependencies.io, options.output, response, createInspectResultMessage(response, options.verbose));
}

function createInspectInput(options: InspectCommandOptions): InspectCommandInput {
  return {
    cwd: process.cwd(),
    environmentName: options.env,
    projectName: options.project,
    serviceName: options.service,
  };
}
