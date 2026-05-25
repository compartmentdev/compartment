import type { Command } from 'commander';
import type { DeployResponse, DeploymentReadSummary } from '@compartment/contracts';
import { renderOutput } from '../../output/render';
import type { AuthenticatedContext } from '../../services/context.types';
import type {
  DeployCommandInput,
  DeployCommandResult,
  DeploymentStatusReporter,
} from '../../services/deployments.types';
import { deployProject } from '../../services/deployments.service';
import { resolveProjectStateScope } from '../../services/project-state-scope.service';
import type { ProjectStateScope } from '../../services/project-state-scope.service.types';
import { listConfiguredRemoteNames } from '../../services/remote-context.service';
import { promptRemoteSelection, type RemoteSelectionPromptOption } from '../../prompts/prompt';
import { buildFirstDeployOnboardingSessionClearedConfig } from '../../store/config.mutations';
import { readCliConfig, writeCliConfig } from '../../store/config.store';
import type { CliConfig } from '../../store/config.types';
import { writeStoredProjectState } from '../../store/project-state.store';
import { assertValidProjectName } from '../projects/project.command.helpers';
import type { CliCommandDependencies, DeployCommandOptions } from '../command.types';
import { createCommandProgress } from '../command.progress';
import type { CommandProgress } from '../command.progress.types';
import { addRemoteOption, createRemoteAuthenticatedContextWithOverrides } from '../remote.command.helpers';
import {
  createDeployDetachMessage,
  createDeployResultMessage,
  createDeploymentProgressReporter,
} from '../deployments/deployment.command.output';

interface DeployRemoteSelectionContext {
  currentRemote: string | undefined;
  projectRoot: string;
  remoteNames: string[];
}

const UNBOUND_MULTI_REMOTE_DEPLOY_MESSAGE: string =
  'Multiple remotes are configured and this repo is not bound to one. Pass --remote <name> or run `compartment remote use <name>` first.';

export function registerDeployCommand(program: Command, dependencies: CliCommandDependencies): void {
  addRemoteOption(
    program
      .command('deploy')
      .option('--env <name>')
      .option('--label <text>')
      .option('--project <name>')
      .option('--service <name>')
      .option('--detach', 'submit the deployment and return immediately')
      .option('--verbose', 'show detailed output')
      .option('--output <format>', 'text or json', 'text'),
  ).action(async (options: DeployCommandOptions): Promise<void> => await executeDeployCommand(dependencies, options));
}

async function executeDeployCommand(
  dependencies: CliCommandDependencies,
  options: DeployCommandOptions,
): Promise<void> {
  assertDeployCommandOptions(options);
  const cwd: string = process.cwd();
  const context: AuthenticatedContext = await createDeployAuthenticatedContext(dependencies, options, cwd);
  const progress: CommandProgress = createCommandProgress({ io: dependencies.io, output: options.output });

  try {
    const response: DeployResponse | DeployCommandResult = await deployProject(
      context,
      createDeployCommandInput(dependencies, options, cwd, progress),
    );
    progress.stop();
    await clearAcceptedFirstDeployOnboardingSession(context, response);
    renderDeployCommandOutput(dependencies, options, response);
  } finally {
    progress.stop();
  }
}

function renderDeployCommandOutput(
  dependencies: CliCommandDependencies,
  options: DeployCommandOptions,
  response: DeployResponse | DeployCommandResult,
): void {
  renderOutput(dependencies.io, options.output, response, createDeployCommandMessage(options, response));
}

function createDeployCommandMessage(
  options: DeployCommandOptions,
  response: DeployResponse | DeployCommandResult,
): string {
  return options.detach === true
    ? createDeployDetachMessage(response as DeployResponse)
    : createDeployResultMessage(response as DeployCommandResult, {
        verbose: options.verbose,
      });
}

async function createDeployAuthenticatedContext(
  dependencies: CliCommandDependencies,
  options: DeployCommandOptions,
  cwd: string,
): Promise<AuthenticatedContext> {
  const remoteName: string | undefined = await resolveDeployRemoteSelection(dependencies, options, cwd);
  return await createRemoteAuthenticatedContextWithOverrides(
    {
      remote: remoteName ?? options.remote,
    },
    { cwd },
  );
}

function assertDeployCommandOptions(options: DeployCommandOptions): void {
  if (options.project !== undefined) {
    assertValidProjectName(options.project);
  }
}

async function resolveDeployRemoteSelection(
  dependencies: CliCommandDependencies,
  options: DeployCommandOptions,
  cwd: string,
): Promise<string | undefined> {
  if (options.remote !== undefined) {
    return undefined;
  }

  const selectionContext: DeployRemoteSelectionContext | undefined = await resolveDeployRemoteSelectionContext(cwd);
  if (selectionContext === undefined) {
    return undefined;
  }
  if (!supportsInteractiveDeployRemoteSelection(dependencies, options)) {
    throw new Error(UNBOUND_MULTI_REMOTE_DEPLOY_MESSAGE);
  }

  const remoteName: string = await promptRemoteSelection(
    dependencies.io,
    createDeployRemoteSelectionOptions(selectionContext.remoteNames, selectionContext.currentRemote),
  );
  await writeStoredProjectState(selectionContext.projectRoot, {
    selectedRemote: remoteName,
  });
  return remoteName;
}

async function resolveDeployRemoteSelectionContext(cwd: string): Promise<DeployRemoteSelectionContext | undefined> {
  const config: CliConfig = await readCliConfig();
  const remoteNames: string[] = listConfiguredRemoteNames(config);
  if (remoteNames.length <= 1) {
    return undefined;
  }

  const scope: ProjectStateScope = await resolveProjectStateScope(cwd);
  if (scope.projectRoot === undefined || scope.effectiveState !== undefined) {
    return undefined;
  }

  return {
    currentRemote: config.currentRemote,
    projectRoot: scope.projectRoot,
    remoteNames,
  };
}

function supportsInteractiveDeployRemoteSelection(
  dependencies: CliCommandDependencies,
  options: DeployCommandOptions,
): boolean {
  return options.output !== 'json' && (dependencies.io.stdin as { isTTY?: boolean | undefined }).isTTY === true;
}

function createDeployRemoteSelectionOptions(
  remoteNames: readonly string[],
  currentRemote: string | undefined,
): RemoteSelectionPromptOption[] {
  const sortedRemoteNames: string[] =
    currentRemote !== undefined && remoteNames.includes(currentRemote)
      ? [currentRemote, ...remoteNames.filter((remoteName: string): boolean => remoteName !== currentRemote)]
      : [...remoteNames];

  return sortedRemoteNames.map(
    (remoteName: string): RemoteSelectionPromptOption => ({
      current: remoteName === currentRemote,
      name: remoteName,
    }),
  );
}

function createDeployCommandInput(
  dependencies: CliCommandDependencies,
  options: DeployCommandOptions,
  cwd: string,
  progress: CommandProgress,
): DeployCommandInput {
  return new DeployCommandInputValue(dependencies, options, cwd, progress);
}

function resolveDeployStatusReporter(
  dependencies: CliCommandDependencies,
  options: DeployCommandOptions,
  progress: CommandProgress,
): DeploymentStatusReporter | undefined {
  if (options.output !== 'text') {
    return undefined;
  }
  if (options.detach === true) {
    return undefined;
  }

  return createDeploymentProgressReporter({ progress });
}

class DeployCommandInputValue implements DeployCommandInput {
  readonly cwd: string;
  readonly detach?: boolean | undefined;
  readonly environmentName?: string | undefined;
  readonly label?: string | undefined;
  readonly onStatusUpdate?: DeploymentStatusReporter | undefined;
  readonly projectName?: string | undefined;
  readonly serviceName?: string | undefined;
  readonly #progress: CommandProgress;

  constructor(
    dependencies: CliCommandDependencies,
    options: DeployCommandOptions,
    cwd: string,
    progress: CommandProgress,
  ) {
    this.cwd = cwd;
    this.detach = options.detach;
    this.environmentName = options.env;
    this.label = options.label;
    this.onStatusUpdate = resolveDeployStatusReporter(dependencies, options, progress);
    this.projectName = options.project;
    this.serviceName = options.service;
    this.#progress = progress;
  }

  reportProgress(message: string): void {
    this.#progress.report(message);
  }
}

async function clearAcceptedFirstDeployOnboardingSession(
  context: AuthenticatedContext,
  response: DeployResponse | DeployCommandResult,
): Promise<void> {
  const onboardingSessionId: string | undefined = context.firstDeployOnboardingSessionId;
  if (onboardingSessionId === undefined) {
    return;
  }
  if (!hasAcceptedFirstDeploySubmission(response)) {
    return;
  }

  await writeCliConfig(
    buildFirstDeployOnboardingSessionClearedConfig(await readCliConfig(), context.remoteName, onboardingSessionId),
  );
}

function hasAcceptedFirstDeploySubmission(response: DeployResponse | DeployCommandResult): boolean {
  if (isDeployResponse(response)) {
    return response.deployments.length > 0;
  }

  return isSucceededDeployCommandResult(response);
}

function isDeployResponse(response: DeployResponse | DeployCommandResult): response is DeployResponse {
  return !('activeDeployments' in response);
}

function isSucceededDeployCommandResult(
  response: DeployResponse | DeployCommandResult,
): response is DeployCommandResult {
  return (
    'activeDeployments' in response &&
    response.deployments.length > 0 &&
    response.deployments.every((deployment: DeploymentReadSummary): boolean => deployment.status === 'succeeded')
  );
}
