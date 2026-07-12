import { compartmentGitLabTokenInvalidErrorCode } from '@compartment/contracts/browser';
import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { BrowserApiError } from '../../lib/browser-api';
import { loadGitHubRepositoryOptions } from './onboarding-github-repositories';
import { readInitialGitFormInput } from './onboarding-git-repository-form-input';
import { loadGitLabRepositoryOptions } from './onboarding-gitlab-repositories';
import type { GitConnectFormInput, OnboardingGitProvider, OnboardingRepositoryOption } from './onboarding-page.types';

export type GitRepositoryLoadStatus = 'failed' | 'idle' | 'loading' | 'ready' | 'token_invalid';

export interface GitRepositoryOptionsState {
  formInput: GitConnectFormInput | null;
  reloadRepositories: () => void;
  repositoryLoadStatus: GitRepositoryLoadStatus;
  repositoryOptions: OnboardingRepositoryOption[];
  setFormInput: Dispatch<SetStateAction<GitConnectFormInput | null>>;
}

interface UseGitRepositoryOptionsInput {
  gitConnected: boolean;
  initialBranchName: string | undefined;
  initialEnvironmentName: string | undefined;
  provider: OnboardingGitProvider;
  providerHost: string;
  registrationId: string | undefined;
  repositoryOwner: string | undefined;
  sessionId: string | undefined;
  selectedRepositoryId: string | undefined;
  selectedOrganizationSlug: string;
}

interface UseLoadGitRepositoryOptionsInput {
  input: UseGitRepositoryOptionsInput;
  reloadToken: number;
  setFormInput: Dispatch<SetStateAction<GitConnectFormInput | null>>;
  setRepositoryLoadStatus: Dispatch<SetStateAction<GitRepositoryLoadStatus>>;
  setRepositoryOptions: Dispatch<SetStateAction<OnboardingRepositoryOption[]>>;
}

interface LoadGitRepositoryOptionsEffectInput {
  gitConnected: boolean;
  initialBranchName: string | undefined;
  initialEnvironmentName: string | undefined;
  provider: OnboardingGitProvider;
  providerHost: string;
  registrationId: string | undefined;
  repositoryOwner: string | undefined;
  sessionId: string | undefined;
  selectedRepositoryId: string | undefined;
  selectedOrganizationSlug: string;
  setFormInput: Dispatch<SetStateAction<GitConnectFormInput | null>>;
  setRepositoryLoadStatus: Dispatch<SetStateAction<GitRepositoryLoadStatus>>;
  setRepositoryOptions: Dispatch<SetStateAction<OnboardingRepositoryOption[]>>;
}

type LoadGitRepositoryOptionsResult =
  | {
      kind: 'ready';
      repositories: OnboardingRepositoryOption[];
    }
  | { kind: 'redirecting' };

class GitRepositoryOptionsStateValue implements GitRepositoryOptionsState {
  public constructor(private readonly input: Readonly<GitRepositoryOptionsState>) {}

  public get formInput(): GitConnectFormInput | null {
    return this.input.formInput;
  }

  public get repositoryLoadStatus(): GitRepositoryLoadStatus {
    return this.input.repositoryLoadStatus;
  }

  public get repositoryOptions(): OnboardingRepositoryOption[] {
    return this.input.repositoryOptions;
  }

  public get setFormInput(): Dispatch<SetStateAction<GitConnectFormInput | null>> {
    return this.input.setFormInput;
  }

  public readonly reloadRepositories: () => void = (): void => {
    this.input.reloadRepositories();
  };
}

export function useGitRepositoryOptions(input: UseGitRepositoryOptionsInput): GitRepositoryOptionsState {
  const [repositoryOptions, setRepositoryOptions] = useState<OnboardingRepositoryOption[]>([]);
  const [formInput, setFormInput] = useState<GitConnectFormInput | null>(null);
  const [repositoryLoadStatus, setRepositoryLoadStatus] = useState<GitRepositoryLoadStatus>('idle');
  const [reloadToken, setReloadToken] = useState<number>(0);

  useLoadGitRepositoryOptions({
    input,
    reloadToken,
    setFormInput,
    setRepositoryLoadStatus,
    setRepositoryOptions,
  });

  return new GitRepositoryOptionsStateValue({
    formInput,
    reloadRepositories: (): void => {
      setReloadToken((current: number): number => current + 1);
    },
    repositoryLoadStatus,
    repositoryOptions,
    setFormInput,
  });
}

function useLoadGitRepositoryOptions(input: UseLoadGitRepositoryOptionsInput): void {
  const effectInput: LoadGitRepositoryOptionsEffectInput = useLoadGitRepositoryOptionsEffectInput(input);
  const { reloadToken } = input;
  useEffect((): (() => void) => {
    return startLoadGitRepositoryOptions(effectInput);
  }, [effectInput, reloadToken]);
}

function useLoadGitRepositoryOptionsEffectInput(
  input: UseLoadGitRepositoryOptionsInput,
): LoadGitRepositoryOptionsEffectInput {
  const { input: options, setFormInput, setRepositoryLoadStatus, setRepositoryOptions } = input;
  return useMemo(
    (): LoadGitRepositoryOptionsEffectInput => ({
      ...options,
      setFormInput,
      setRepositoryLoadStatus,
      setRepositoryOptions,
    }),
    // prettier-ignore
    [options.gitConnected, options.initialBranchName, options.initialEnvironmentName, options.provider, options.providerHost, options.registrationId, options.repositoryOwner, options.sessionId, options.selectedRepositoryId, options.selectedOrganizationSlug, setFormInput, setRepositoryLoadStatus, setRepositoryOptions],
  );
}

function startLoadGitRepositoryOptions(input: LoadGitRepositoryOptionsEffectInput): () => void {
  if (!input.gitConnected) return skipRepositoryLoad(input);
  let canceled: boolean = false;
  input.setRepositoryLoadStatus('loading');
  void loadGitRepositoryOptions(input)
    .then((result: LoadGitRepositoryOptionsResult): void => {
      updateLoadedRepositories(input, result, canceled);
    })
    .catch((error: Error): void => {
      if (!canceled) {
        input.setRepositoryLoadStatus(readRepositoryLoadFailureStatus(error));
      }
    });
  return (): void => {
    canceled = true;
  };
}

function skipRepositoryLoad(input: LoadGitRepositoryOptionsEffectInput): () => void {
  input.setRepositoryLoadStatus('idle');
  return (): void => undefined;
}

function readRepositoryLoadFailureStatus(error: Error): GitRepositoryLoadStatus {
  return error instanceof BrowserApiError && error.code === compartmentGitLabTokenInvalidErrorCode
    ? 'token_invalid'
    : 'failed';
}

function updateLoadedRepositories(
  input: LoadGitRepositoryOptionsEffectInput,
  result: LoadGitRepositoryOptionsResult,
  canceled: boolean,
): void {
  if (canceled || result.kind === 'redirecting') {
    return;
  }
  const repositories: OnboardingRepositoryOption[] = result.repositories;
  input.setRepositoryOptions(repositories);
  input.setFormInput((current: GitConnectFormInput | null): GitConnectFormInput | null =>
    readInitialGitFormInput(repositories, current, {
      initialBranchName: input.initialBranchName,
      initialEnvironmentName: input.initialEnvironmentName,
      selectedRepositoryId: input.selectedRepositoryId,
    }),
  );
  input.setRepositoryLoadStatus('ready');
}

async function loadGitRepositoryOptions(input: UseGitRepositoryOptionsInput): Promise<LoadGitRepositoryOptionsResult> {
  if (input.registrationId === undefined) {
    return buildReadyGitRepositoryOptionsResult([]);
  }
  const registrationId: string = input.registrationId;
  if (input.provider === 'gitlab') {
    return buildReadyGitRepositoryOptionsResult(
      await loadGitLabRepositoryOptions(input.selectedOrganizationSlug, registrationId, input.providerHost),
    );
  }
  if (input.repositoryOwner === undefined) return buildReadyGitRepositoryOptionsResult([]);
  return await loadGitHubRepositoryOptions({
    registrationId,
    repositoryOwner: input.repositoryOwner,
    selectedOrganizationSlug: input.selectedOrganizationSlug,
    sessionId: input.sessionId,
  });
}

function buildReadyGitRepositoryOptionsResult(
  repositories: OnboardingRepositoryOption[],
): LoadGitRepositoryOptionsResult {
  return {
    kind: 'ready',
    repositories,
  };
}
