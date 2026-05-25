import { useState, type JSX } from 'react';
import { GitRepositoryStep } from './onboarding-git-repository';
import type { GitRepositoryLoadStatus } from './onboarding-git-repository-options-state';
import type { GitConnectFormInput, GitConnectFormPatch, OnboardingRepositoryOption } from './onboarding-page.types';

interface GitRepositoryPickerProps {
  formInput: GitConnectFormInput;
  onFormChange: (patch: GitConnectFormPatch) => void;
  onReloadRepositories: () => void;
  onRepositoryChange: (repositoryId: string) => void;
  onRepositorySelected: (formInput: GitConnectFormInput) => Promise<void>;
  repositoryLoadStatus: GitRepositoryLoadStatus;
  repositoryOptions: OnboardingRepositoryOption[];
}

interface GitRepositorySubmitState {
  isSubmitting: boolean;
  onSubmit: () => void;
  submitError: string | null;
}

interface GitRepositorySubmitStateInput {
  formInput: GitConnectFormInput;
  onRepositorySelected: (formInput: GitConnectFormInput) => Promise<void>;
  setSubmitError: (message: string | null) => void;
  setSubmitStatus: (status: GitRepositorySubmitStatus) => void;
  submitError: string | null;
  submitStatus: GitRepositorySubmitStatus;
}

interface GitRepositoryPickerContentProps extends GitRepositoryPickerProps {
  submitState: GitRepositorySubmitState;
}

type GitRepositorySubmitStatus = 'failed' | 'idle' | 'loading';

class GitRepositorySubmitStateValue implements GitRepositorySubmitState {
  public constructor(private readonly input: Readonly<GitRepositorySubmitStateInput>) {}

  public get isSubmitting(): boolean {
    return this.input.submitStatus === 'loading';
  }

  public get submitError(): string | null {
    return this.input.submitStatus === 'failed' ? this.input.submitError : null;
  }

  public readonly onSubmit: () => void = (): void => {
    this.input.setSubmitError(null);
    this.input.setSubmitStatus('loading');
    this.input
      .onRepositorySelected(this.input.formInput)
      .then((): void => {
        this.input.setSubmitStatus('idle');
      })
      .catch((error: Error): void => {
        this.input.setSubmitError(readSubmitErrorMessage(error));
        this.input.setSubmitStatus('failed');
      });
  };
}

export function GitRepositoryPicker({ formInput, ...props }: Readonly<GitRepositoryPickerProps>): JSX.Element {
  const submitState: GitRepositorySubmitState = useGitRepositorySubmitState(formInput, props.onRepositorySelected);
  return <GitRepositoryPickerContent {...props} formInput={formInput} submitState={submitState} />;
}

function GitRepositoryPickerContent(props: Readonly<GitRepositoryPickerContentProps>): JSX.Element {
  return (
    <div className="p-5">
      <GitRepositoryStep
        formInput={props.formInput}
        isSubmitting={props.submitState.isSubmitting}
        onChange={props.onFormChange}
        onReloadRepositories={props.onReloadRepositories}
        onRepositoryChange={props.onRepositoryChange}
        onSubmit={props.submitState.onSubmit}
        repositoryLoadStatus={props.repositoryLoadStatus}
        repositoryOptions={props.repositoryOptions}
        submitError={props.submitState.submitError}
        submitLabel="Use selected repository"
      />
    </div>
  );
}

function useGitRepositorySubmitState(
  formInput: GitConnectFormInput,
  onRepositorySelected: (formInput: GitConnectFormInput) => Promise<void>,
): GitRepositorySubmitState {
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitStatus, setSubmitStatus] = useState<GitRepositorySubmitStatus>('idle');

  return new GitRepositorySubmitStateValue({
    formInput,
    onRepositorySelected,
    setSubmitError,
    setSubmitStatus,
    submitError,
    submitStatus,
  });
}

function readSubmitErrorMessage(error: Error): string {
  if (error.message.length > 0) {
    return error.message;
  }

  return 'Could not use this repository. Refresh repositories and try again.';
}
