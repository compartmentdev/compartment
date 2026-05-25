import type { CliIo } from '../../app.types';
import type { OutputFormat } from '../../output/output.types';
import { promptProjectBindingRepair, promptProjectBindingSave, promptProjectBindingScope } from '../../prompts/prompt';
import { isGitTrackedFile, toRepositoryRelativePath } from '../../services/git-repository.service';
import { resolveProjectStateScope } from '../../services/project-state-scope.service';
import type { ProjectStateScope, StoredProjectStateReference } from '../../services/project-state-scope.service.types';
import { findConfiguredRemote } from '../../services/remote-context.service';
import { readProjectStateFilePath, writeStoredProjectState } from '../../store/project-state.store';
import type { StoredProjectState } from '../../store/project-state.types';
import type { CliConfig } from '../../store/config.types';

interface PersistLoginBindingInput {
  config: CliConfig;
  cwd: string;
  io: CliIo;
  output: OutputFormat;
  remoteName: string;
}

export async function persistLoginBindingIfNeeded(input: PersistLoginBindingInput): Promise<void> {
  if (!supportsInteractiveBindingPrompt(input.io, input.output)) {
    return;
  }

  try {
    const scope: ProjectStateScope = await resolveProjectStateScope(input.cwd);
    if (scope.projectRoot === undefined) {
      return;
    }

    await persistInteractiveLoginBinding(input, scope);
  } catch (error) {
    input.io.stderr(
      `Warning: login succeeded, but the repo binding was not updated: ${error instanceof Error ? error.message : 'Unknown binding error.'}\n`,
    );
  }
}

async function persistInteractiveLoginBinding(
  input: PersistLoginBindingInput,
  scope: ProjectStateScope,
): Promise<void> {
  const brokenState: StoredProjectStateReference | undefined = findBrokenProjectState(scope, input.config);
  if (brokenState !== undefined) {
    await repairBrokenProjectState(input, scope, brokenState);
    return;
  }
  if (scope.effectiveState !== undefined) {
    return;
  }
  if (!(await promptProjectBindingSave(input.io, input.remoteName))) {
    return;
  }

  const bindingRoot: string = await resolveBindingRoot(input.io, scope);
  await writeStoredProjectState(bindingRoot, {
    selectedRemote: input.remoteName,
  });
  await warnIfTrackedProjectState(input.io, scope.gitRoot, bindingRoot);
}

async function repairBrokenProjectState(
  input: PersistLoginBindingInput,
  scope: ProjectStateScope,
  brokenState: StoredProjectStateReference,
): Promise<void> {
  if (!(await promptProjectBindingRepair(input.io, input.remoteName))) {
    return;
  }

  await writeStoredProjectState(brokenState.root, buildRepairedProjectState(input.remoteName));
  await warnIfTrackedProjectState(input.io, scope.gitRoot, brokenState.root);
}

function findBrokenProjectState(scope: ProjectStateScope, config: CliConfig): StoredProjectStateReference | undefined {
  const effectiveState: StoredProjectStateReference | undefined = scope.effectiveState;
  if (effectiveState === undefined) {
    return undefined;
  }

  const state: StoredProjectState = effectiveState.state;
  if (state.selectedRemote !== undefined && findConfiguredRemote(config, state.selectedRemote) === undefined) {
    return effectiveState;
  }

  return undefined;
}

function buildRepairedProjectState(remoteName: string): StoredProjectState {
  return {
    selectedRemote: remoteName,
  };
}

async function resolveBindingRoot(io: CliIo, scope: ProjectStateScope): Promise<string> {
  const projectRoot: string = scope.projectRoot!;
  if (scope.gitRoot === undefined || scope.gitRoot === projectRoot) {
    return projectRoot;
  }

  const selectedScope: 'git-root' | 'project-root' = await promptProjectBindingScope(
    io,
    toRepositoryRelativePath(scope.gitRoot, projectRoot),
    '.',
  );
  return selectedScope === 'git-root' ? scope.gitRoot : projectRoot;
}

async function warnIfTrackedProjectState(io: CliIo, gitRoot: string | undefined, stateRoot: string): Promise<void> {
  if (gitRoot === undefined) {
    return;
  }

  const stateFilePath: string = readProjectStateFilePath(stateRoot);
  if (!(await isGitTrackedFile(gitRoot, stateFilePath))) {
    return;
  }

  io.stderr(
    `Warning: ${stateFilePath} is Git-tracked. .compartment/state.json stores local remote bindings and should not be committed as shared repo config.\n`,
  );
}

function supportsInteractiveBindingPrompt(io: CliIo, output: OutputFormat): boolean {
  return output !== 'json' && (io.stdin as { isTTY?: boolean | undefined }).isTTY === true;
}
