import type { ChangeEvent, JSX } from 'react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { LoaderCircle } from '../../components/ui/icons';
import type { GitRepositoryLoadStatus } from './onboarding-git-repository-options-state';
import { RepositorySelect } from './onboarding-git-repository-select';
import { readGitRepositoryFormError } from './onboarding-git-repository-validation';
import { GitSelectedSourcePanel } from './onboarding-git-selected-source-panel';
import type { GitConnectFormInput, GitConnectFormPatch, OnboardingRepositoryOption } from './onboarding-page.types';

interface GitRepositoryStepProps {
  formInput: GitConnectFormInput;
  isSubmitting: boolean;
  onChange: (patch: GitConnectFormPatch) => void;
  onReloadRepositories: () => void;
  onRepositoryChange: (repositoryId: string) => void;
  onSubmit: () => void;
  repositoryLoadStatus: GitRepositoryLoadStatus;
  repositoryOptions: OnboardingRepositoryOption[];
  submitError: string | null;
  submitLabel?: string | undefined;
}

interface GitRepositoryFieldsProps {
  formInput: GitConnectFormInput;
  onChange: (patch: GitConnectFormPatch) => void;
  onReloadRepositories: () => void;
  onRepositoryChange: (repositoryId: string) => void;
  repositoryLoadStatus: GitRepositoryLoadStatus;
  repositoryOptions: OnboardingRepositoryOption[];
}

interface GitRepositoryBodyProps {
  formInput: GitConnectFormInput;
  onChange: (patch: GitConnectFormPatch) => void;
  onReloadRepositories: () => void;
  onRepositoryChange: (repositoryId: string) => void;
  repositoryLoadStatus: GitRepositoryLoadStatus;
  repositoryOptions: OnboardingRepositoryOption[];
}

interface GitTextFieldProps {
  label: string;
  onChange: (value: string) => void;
  status?: 'invalid' | 'valid' | undefined;
  value: string;
}

interface GitRepositoryTextFieldsProps {
  formInput: GitConnectFormInput;
  onChange: (patch: GitConnectFormPatch) => void;
}

interface GitRepositorySubmitProps {
  isSubmitting: boolean;
  onSubmit: () => void;
  repositoryLoadStatus: GitRepositoryLoadStatus;
  submitLabel: string;
  validationError: string | null;
}

interface GitRepositoryStepContentProps extends GitRepositoryStepProps {
  submitLabel: string;
  validationError: string | null;
}

export function GitRepositoryStep(props: Readonly<GitRepositoryStepProps>): JSX.Element {
  const validationError: string | null = readGitRepositoryFormError(props.formInput);
  return (
    <GitRepositoryStepContent
      {...props}
      submitLabel={props.submitLabel ?? 'Connect source'}
      validationError={validationError}
    />
  );
}

function GitRepositoryStepContent(props: Readonly<GitRepositoryStepContentProps>): JSX.Element {
  return (
    <div className="grid gap-5">
      <GitRepositoryHeader />
      <GitRepositoryBody {...props} />
      <GitRepositorySubmitSection
        isSubmitting={props.isSubmitting}
        onSubmit={props.onSubmit}
        repositoryLoadStatus={props.repositoryLoadStatus}
        submitError={props.submitError}
        submitLabel={props.submitLabel}
        validationError={props.validationError}
      />
    </div>
  );
}

function GitRepositorySubmitError(
  props: Readonly<Pick<GitRepositoryStepContentProps, 'submitError' | 'validationError'>>,
): JSX.Element {
  return (
    <>
      {props.validationError !== null ? (
        <p className="text-[13px] leading-5 text-[#b42318]">{props.validationError}</p>
      ) : null}
      {props.submitError !== null ? <p className="text-[13px] leading-5 text-[#b42318]">{props.submitError}</p> : null}
    </>
  );
}

function GitRepositorySubmit(props: Readonly<GitRepositorySubmitProps>): JSX.Element {
  return (
    <Button
      className="w-fit"
      disabled={props.isSubmitting || props.validationError !== null || props.repositoryLoadStatus === 'loading'}
      onClick={props.onSubmit}
      type="button"
    >
      {props.isSubmitting ? <LoaderCircle aria-hidden="true" className="animate-spin" size={15} /> : null}
      {props.isSubmitting ? 'Checking repository' : props.submitLabel}
    </Button>
  );
}

function GitRepositorySubmitSection(
  props: Readonly<GitRepositorySubmitProps & Pick<GitRepositoryStepProps, 'submitError'>>,
): JSX.Element {
  return (
    <>
      <GitRepositorySubmitError submitError={props.submitError} validationError={props.validationError} />
      <GitRepositorySubmit {...props} />
    </>
  );
}

function GitRepositoryBody({
  formInput,
  onChange,
  onReloadRepositories,
  onRepositoryChange,
  repositoryLoadStatus,
  repositoryOptions,
}: Readonly<GitRepositoryBodyProps>): JSX.Element {
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_260px]">
      <GitRepositoryFields
        formInput={formInput}
        onChange={onChange}
        onReloadRepositories={onReloadRepositories}
        onRepositoryChange={onRepositoryChange}
        repositoryLoadStatus={repositoryLoadStatus}
        repositoryOptions={repositoryOptions}
      />
      <GitSelectedSourcePanel formInput={formInput} />
    </div>
  );
}

function GitRepositoryHeader(): JSX.Element {
  return (
    <div>
      <h2 className="text-[24px] font-semibold leading-8">Choose repository</h2>
      <p className="mt-2 max-w-2xl text-[14px] leading-6 text-[#485259]">
        Select the repository, branch, and environment that should produce the first deployment.
      </p>
    </div>
  );
}

function GitRepositoryFields({
  formInput,
  onChange,
  onReloadRepositories,
  onRepositoryChange,
  repositoryLoadStatus,
  repositoryOptions,
}: Readonly<GitRepositoryFieldsProps>): JSX.Element {
  return (
    <div className="grid gap-4 rounded-card border border-black/10 bg-card p-4">
      <RepositorySelect
        formInput={formInput}
        onReloadRepositories={onReloadRepositories}
        onRepositoryChange={onRepositoryChange}
        options={repositoryOptions}
        repositoryLoadStatus={repositoryLoadStatus}
      />
      <GitRepositoryTextFields formInput={formInput} onChange={onChange} />
    </div>
  );
}

function GitRepositoryTextFields({ formInput, onChange }: Readonly<GitRepositoryTextFieldsProps>): JSX.Element {
  return (
    <>
      <GitTextField
        label="Branch"
        onChange={(value: string): void => {
          onChange({ branchName: value });
        }}
        value={formInput.branchName}
      />
      <GitTextField
        label="Environment"
        onChange={(value: string): void => {
          onChange({ environmentName: value });
        }}
        value={formInput.environmentName}
      />
    </>
  );
}

function GitTextField({ label, onChange, status = 'valid', value }: Readonly<GitTextFieldProps>): JSX.Element {
  function handleChange(event: ChangeEvent<HTMLInputElement>): void {
    onChange(event.currentTarget.value);
  }

  return (
    <label className="grid gap-2">
      <span className="text-[12px] font-medium uppercase text-[#485259]">{label}</span>
      <Input aria-invalid={status === 'invalid'} onChange={handleChange} value={value} />
    </label>
  );
}
