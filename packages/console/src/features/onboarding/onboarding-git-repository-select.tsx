import type { ChangeEvent, JSX } from 'react';
import { Button } from '../../components/ui/button';
import { Select } from '../../components/select';
import { RefreshCw } from '../../components/ui/icons';
import type { GitRepositoryLoadStatus } from './onboarding-git-repository-options-state';
import type { GitConnectFormInput, OnboardingRepositoryOption } from './onboarding-page.types';

interface RepositorySelectProps {
  formInput: GitConnectFormInput;
  onReloadRepositories: () => void;
  onRepositoryChange: (repositoryId: string) => void;
  options: OnboardingRepositoryOption[];
  repositoryLoadStatus: GitRepositoryLoadStatus;
}

export function RepositorySelect({
  formInput,
  onReloadRepositories,
  onRepositoryChange,
  options,
  repositoryLoadStatus,
}: Readonly<RepositorySelectProps>): JSX.Element {
  return (
    <label className="grid gap-2">
      <RepositorySelectHeader onReloadRepositories={onReloadRepositories} repositoryLoadStatus={repositoryLoadStatus} />
      <RepositorySelectControl
        formInput={formInput}
        onRepositoryChange={onRepositoryChange}
        options={options}
        repositoryLoadStatus={repositoryLoadStatus}
      />
      <RepositoryLoadFailure repositoryLoadStatus={repositoryLoadStatus} />
    </label>
  );
}

function RepositorySelectControl({
  formInput,
  onRepositoryChange,
  options,
  repositoryLoadStatus,
}: Readonly<Omit<RepositorySelectProps, 'onReloadRepositories'>>): JSX.Element {
  function handleRepositoryChange(event: ChangeEvent<HTMLSelectElement>): void {
    onRepositoryChange(event.currentTarget.value);
  }

  return (
    <Select
      disabled={repositoryLoadStatus === 'loading'}
      onChange={handleRepositoryChange}
      value={formInput.repository.id}
    >
      {options.map(toRepositoryOptionElement)}
    </Select>
  );
}

function toRepositoryOptionElement(repository: OnboardingRepositoryOption): JSX.Element {
  return (
    <option key={repository.id} value={repository.id}>
      {repository.owner}/{repository.name}
    </option>
  );
}

function RepositoryLoadFailure({
  repositoryLoadStatus,
}: Readonly<Pick<RepositorySelectProps, 'repositoryLoadStatus'>>): JSX.Element | null {
  return repositoryLoadStatus === 'failed' ? (
    <span className="text-[13px] leading-5 text-[#b42318]">Could not load repositories. Refresh and try again.</span>
  ) : null;
}

function RepositorySelectHeader({
  onReloadRepositories,
  repositoryLoadStatus,
}: Readonly<Pick<RepositorySelectProps, 'onReloadRepositories' | 'repositoryLoadStatus'>>): JSX.Element {
  return (
    <span className="flex items-center justify-between gap-3">
      <span className="text-[12px] font-medium uppercase text-[#485259]">Repository</span>
      <Button
        disabled={repositoryLoadStatus === 'loading'}
        onClick={onReloadRepositories}
        size="sm"
        type="button"
        variant="outline"
      >
        <RefreshCw
          aria-hidden="true"
          className={repositoryLoadStatus === 'loading' ? 'animate-spin' : undefined}
          size={14}
        />
        Refresh
      </Button>
    </span>
  );
}
