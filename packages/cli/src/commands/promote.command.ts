import type { Command } from 'commander';
import type { DeploymentStatusResponse } from '@compartment/contracts';
import { renderOutput } from '../output/render';
import type { DeploymentStatusReporter } from '../services/deployments.types';
import { promoteProjectDeployment } from '../services/deployment-movement.service';
import type { DeploymentCommandServiceScope, PromoteCommandInput } from '../services/deployment-movement.types';
import { createDeploymentCommandServiceScope } from './deployment-movement.command.helpers';
import { createDeployResultMessage, createDeploymentProgressReporter } from './deployments/deployment.command.output';
import { assertValidProjectName } from './projects/project.command.helpers';
import type { CliCommandDependencies, PromoteCommandOptions } from './command.types';
import { createCommandProgress } from './command.progress';
import type { CommandProgress } from './command.progress.types';
import { addRemoteOption, createRemoteAuthenticatedContext } from './remote.command.helpers';

export function registerPromoteCommand(program: Command, dependencies: CliCommandDependencies): void {
  addRemoteOption(
    program
      .command('promote')
      .requiredOption('--from <name>')
      .option('--to <name>')
      .option('--project <name>')
      .option('--service <name>')
      .option('--verbose', 'show detailed deployment output')
      .option('--output <format>', 'text or json', 'text'),
  ).action(async (options: PromoteCommandOptions): Promise<void> => await executePromoteCommand(dependencies, options));
}

async function executePromoteCommand(
  dependencies: CliCommandDependencies,
  options: PromoteCommandOptions,
): Promise<void> {
  assertPromoteCommandOptions(options);
  const progress: CommandProgress = createCommandProgress({ io: dependencies.io, output: options.output });

  try {
    const response: DeploymentStatusResponse = await promoteProjectDeployment(
      await createRemoteAuthenticatedContext(options),
      createPromoteCommandInput(dependencies, options, progress),
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

function assertPromoteCommandOptions(options: PromoteCommandOptions): void {
  if (options.project !== undefined) {
    assertValidProjectName(options.project);
  }
}

function createPromoteCommandInput(
  dependencies: CliCommandDependencies,
  options: PromoteCommandOptions,
  progress: CommandProgress,
): PromoteCommandInput {
  return new PromoteCommandInputValue(dependencies, options, progress);
}

function resolvePromoteStatusReporter(
  dependencies: CliCommandDependencies,
  options: PromoteCommandOptions,
  progress: CommandProgress,
): DeploymentStatusReporter | undefined {
  if (options.output !== 'text') {
    return undefined;
  }

  return createDeploymentProgressReporter({ progress });
}

class PromoteCommandInputValue implements PromoteCommandInput {
  readonly cwd: string = process.cwd();
  readonly onStatusUpdate?: DeploymentStatusReporter | undefined;
  readonly projectName?: string | undefined;
  readonly scope: DeploymentCommandServiceScope;
  readonly sourceEnvironmentName: string;
  readonly targetEnvironmentName?: string | undefined;
  readonly #progress: CommandProgress;

  constructor(dependencies: CliCommandDependencies, options: PromoteCommandOptions, progress: CommandProgress) {
    this.onStatusUpdate = resolvePromoteStatusReporter(dependencies, options, progress);
    this.projectName = options.project;
    this.scope = createDeploymentCommandServiceScope(options.service);
    this.sourceEnvironmentName = options.from;
    this.targetEnvironmentName = options.to;
    this.#progress = progress;
  }

  reportProgress(message: string): void {
    this.#progress.report(message);
  }
}
