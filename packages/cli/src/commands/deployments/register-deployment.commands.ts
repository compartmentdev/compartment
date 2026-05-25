import type { Command } from 'commander';
import { registerListDeploymentsCommand } from './list-deployments.command';
import { registerDeploymentLogsCommand } from './log-deployment.command';
import type { CliCommandDependencies } from '../command.types';

export function registerDeploymentCommands(program: Command, dependencies: CliCommandDependencies): void {
  const deploymentCommand: Command = program.command('deployment');
  registerDeploymentLogsCommand(deploymentCommand, dependencies);
  registerListDeploymentsCommand(deploymentCommand, dependencies);
}
