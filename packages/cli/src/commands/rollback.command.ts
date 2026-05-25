import type { Command } from 'commander';
import type { DeploymentStatusResponse } from '@compartment/contracts';
import { renderOutput } from '../output/render';
import type { DeploymentStatusReporter } from '../services/deployments.types';
import { rollbackProjectDeployment } from '../services/deployment-movement.service';
import type { RollbackCommandInput, RollbackCommandTarget } from '../services/deployment-movement.types';
import { createDeploymentCommandServiceScope } from './deployment-movement.command.helpers';
import { createDeployResultMessage, createDeploymentProgressReporter } from './deployments/deployment.command.output';
import { assertValidProjectName } from './projects/project.command.helpers';
import type { CliCommandDependencies, RollbackCommandOptions } from './command.types';
import { createCommandProgress } from './command.progress';
import type { CommandProgress } from './command.progress.types';
import { addRemoteOption, createRemoteAuthenticatedContext } from './remote.command.helpers';

export function registerRollbackCommand(program: Command, dependencies: CliCommandDependencies): void {
  addRemoteOption(
    program
      .command('rollback')
      .option('--env <name>', 'environment to roll back')
      .option('--project <name>', 'project to roll back')
      .option('--run <deployment-run-id>', 'roll back the selected environment to a historical deployment run')
      .option('--service <name>', 'roll back only one service')
      .option('--to <deployment-id>', 'roll back one service to a specific deployment')
      .option('--verbose', 'show detailed deployment output')
      .option('--output <format>', 'text or json', 'text'),
  ).action(
    async (options: RollbackCommandOptions): Promise<void> => await executeRollbackCommand(dependencies, options),
  );
}

async function executeRollbackCommand(
  dependencies: CliCommandDependencies,
  options: RollbackCommandOptions,
): Promise<void> {
  assertRollbackCommandOptions(options);
  const progress: CommandProgress = createCommandProgress({ io: dependencies.io, output: options.output });

  try {
    const response: DeploymentStatusResponse = await rollbackProjectDeployment(
      await createRemoteAuthenticatedContext(options),
      createRollbackCommandInput(dependencies, options, progress),
    );

    progress.stop();
    renderOutput(
      dependencies.io,
      options.output,
      response,
      createDeployResultMessage(response, {
        verbose: options.verbose,
      }),
    );
  } finally {
    progress.stop();
  }
}

function assertRollbackCommandOptions(options: RollbackCommandOptions): void {
  if (options.project !== undefined) {
    assertValidProjectName(options.project);
  }
  if (options.run !== undefined && options.to !== undefined) {
    throw new Error('Rollback accepts either --run <deployment-run-id> or --to <deployment-id>, not both.');
  }
  if (options.run !== undefined && options.service !== undefined) {
    throw new Error('Rollback to a deployment run does not accept --service.');
  }
}

function createRollbackCommandInput(
  dependencies: CliCommandDependencies,
  options: RollbackCommandOptions,
  progress: CommandProgress,
): RollbackCommandInput {
  return new RollbackCommandInputValue(dependencies, options, progress);
}

function createRollbackCommandTarget(options: RollbackCommandOptions): RollbackCommandTarget {
  if (options.to !== undefined) {
    return {
      mode: 'deployment',
      scope: createDeploymentCommandServiceScope(options.service),
      targetDeploymentId: options.to,
    };
  }
  if (options.run !== undefined) {
    return {
      mode: 'run',
      targetDeploymentRunId: options.run,
    };
  }

  return {
    mode: 'previous',
    scope: createDeploymentCommandServiceScope(options.service),
  };
}

function resolveRollbackStatusReporter(
  dependencies: CliCommandDependencies,
  options: RollbackCommandOptions,
  progress: CommandProgress,
): DeploymentStatusReporter | undefined {
  if (options.output !== 'text') {
    return undefined;
  }

  return createDeploymentProgressReporter({ progress });
}

class RollbackCommandInputValue implements RollbackCommandInput {
  readonly cwd: string = process.cwd();
  readonly environmentName?: string | undefined;
  readonly onStatusUpdate?: DeploymentStatusReporter | undefined;
  readonly projectName?: string | undefined;
  readonly target: RollbackCommandTarget;
  readonly #progress: CommandProgress;

  constructor(dependencies: CliCommandDependencies, options: RollbackCommandOptions, progress: CommandProgress) {
    this.environmentName = options.env;
    this.onStatusUpdate = resolveRollbackStatusReporter(dependencies, options, progress);
    this.projectName = options.project;
    this.target = createRollbackCommandTarget(options);
    this.#progress = progress;
  }

  reportProgress(message: string): void {
    this.#progress.report(message);
  }
}
