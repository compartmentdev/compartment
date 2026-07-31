import { useEffect, type ChangeEvent, type JSX } from 'react';
import type { GitDescriptorDraftFile, GitDescriptorPullRequestResponse } from '@compartment/contracts/browser';
import { Select } from '../../components/select';
import type {
  GitConnectFormInput,
  GitDescriptorTargetOption,
  OnboardingRepositoryOption,
} from './onboarding-page.types';
import { OpenDescriptorPullRequestButton } from './onboarding-git-descriptor-pr-open-button';
import { OnboardingCommandBlock, OnboardingStatus } from './onboarding-shared';
import { onboardingStatusPollingIntervalMs } from './onboarding-status-polling';

interface GitDescriptorPrStepProps {
  isPrPending: boolean;
  onCreatePr: () => Promise<GitDescriptorPullRequestResponse>;
  onPrCreated: (response: GitDescriptorPullRequestResponse) => void;
  onPrMerged: () => Promise<void>;
  onTargetChange: (targetId: string) => void;
  formInput: GitConnectFormInput;
  target: GitDescriptorTargetOption;
  targetOptions: GitDescriptorTargetOption[];
}

interface DescriptorTargetSelectProps {
  onTargetChange: (targetId: string) => void;
  target: GitDescriptorTargetOption;
  targetOptions: GitDescriptorTargetOption[];
}

interface GitDescriptorPrCreateProps {
  formInput: GitConnectFormInput;
  isGitLab: boolean;
  onCreatePr: () => Promise<GitDescriptorPullRequestResponse>;
  onPrCreated: (response: GitDescriptorPullRequestResponse) => void;
  onTargetChange: (targetId: string) => void;
  target: GitDescriptorTargetOption;
  targetOptions: GitDescriptorTargetOption[];
}

interface DescriptorRepositoryProps {
  repository: OnboardingRepositoryOption;
}

interface DescriptorPreviewProps {
  isGitLab: boolean;
  target: GitDescriptorTargetOption;
}

interface GitDescriptorPrHeaderProps {
  isGitLab: boolean;
  repository: OnboardingRepositoryOption;
  target: GitDescriptorTargetOption;
}

interface GitDescriptorPrWaitingProps {
  isGitLab: boolean;
  onPrMerged: () => Promise<void>;
}

interface CreatePrButtonProps {
  isGitLab: boolean;
  onCreatePr: () => Promise<GitDescriptorPullRequestResponse>;
  onPrCreated: (response: GitDescriptorPullRequestResponse) => void;
}

export function GitDescriptorPrStep({
  formInput,
  isPrPending,
  onCreatePr,
  onPrCreated,
  onPrMerged,
  onTargetChange,
  target,
  targetOptions,
}: Readonly<GitDescriptorPrStepProps>): JSX.Element {
  if (isPrPending) {
    return <GitDescriptorPrWaiting isGitLab={formInput.repository.provider === 'gitlab'} onPrMerged={onPrMerged} />;
  }

  return (
    <GitDescriptorPrCreate
      formInput={formInput}
      isGitLab={formInput.repository.provider === 'gitlab'}
      onCreatePr={onCreatePr}
      onPrCreated={onPrCreated}
      onTargetChange={onTargetChange}
      target={target}
      targetOptions={targetOptions}
    />
  );
}

function GitDescriptorPrCreate({
  formInput,
  isGitLab,
  onCreatePr,
  onPrCreated,
  onTargetChange,
  target,
  targetOptions,
}: Readonly<GitDescriptorPrCreateProps>): JSX.Element {
  return (
    <div className="grid gap-5 p-5">
      <GitDescriptorPrHeader isGitLab={isGitLab} repository={formInput.repository} target={target} />
      <DescriptorRepository repository={formInput.repository} />
      <DescriptorTargetSelect onTargetChange={onTargetChange} target={target} targetOptions={targetOptions} />
      <DescriptorPreview isGitLab={isGitLab} target={target} />
      <CreatePrButton isGitLab={isGitLab} onCreatePr={onCreatePr} onPrCreated={onPrCreated} />
    </div>
  );
}

function GitDescriptorPrWaiting({ isGitLab, onPrMerged }: Readonly<GitDescriptorPrWaitingProps>): JSX.Element {
  usePullRequestStatusPolling(onPrMerged);

  return (
    <div className="grid gap-5 p-5">
      <div>
        <h2 className="text-[24px] font-semibold leading-8">
          Waiting for {isGitLab ? 'merge request' : 'pull request'} merge
        </h2>
        <p className="mt-2 max-w-2xl text-[14px] leading-6 text-[#485259]">
          The {isGitLab ? 'merge request' : 'pull request'} is open. Merge it to let Compartment deploy from this
          repository.
        </p>
      </div>
      <OnboardingStatus
        label={isGitLab ? 'Merge request' : 'Pull request'}
        onRefresh={onPrMerged}
        value={`Waiting for ${isGitLab ? 'merge request' : 'pull request'} merge`}
      />
    </div>
  );
}

function GitDescriptorPrHeader({ isGitLab, repository, target }: Readonly<GitDescriptorPrHeaderProps>): JSX.Element {
  const requestName: string = isGitLab ? 'merge request' : 'pull request';
  const requestShortName: string = isGitLab ? 'MR' : 'PR';
  const title: string = target.files.length > 1 ? `Create starter app ${requestName}` : 'Create compartment.yml';
  const description: string =
    target.files.length > 1
      ? `${repository.owner}/${repository.name} does not have a deployable app yet. Compartment can create a starter app ${requestShortName} for you.`
      : `${repository.owner}/${repository.name} does not have a descriptor yet. Pick the app folder and create a ${requestShortName}.`;
  return (
    <div>
      <h2 className="text-[24px] font-semibold leading-8">{title}</h2>
      <p className="mt-2 max-w-2xl text-[14px] leading-6 text-[#485259]">{description}</p>
    </div>
  );
}

function DescriptorTargetSelect({
  onTargetChange,
  target,
  targetOptions,
}: Readonly<DescriptorTargetSelectProps>): JSX.Element {
  function handleTargetChange(event: ChangeEvent<HTMLSelectElement>): void {
    onTargetChange(event.currentTarget.value);
  }

  return (
    <label className="grid max-w-md gap-2">
      <span className="text-[12px] font-medium uppercase text-[#485259]">App folder</span>
      <Select onChange={handleTargetChange} value={target.id}>
        {targetOptions.map(
          (option: GitDescriptorTargetOption): JSX.Element => (
            <option key={option.id} value={option.id}>
              {readAppFolderLabel(option.directory)}
            </option>
          ),
        )}
      </Select>
    </label>
  );
}

function DescriptorRepository({ repository }: Readonly<DescriptorRepositoryProps>): JSX.Element {
  return (
    <div className="grid max-w-md gap-1">
      <p className="text-[12px] font-medium uppercase text-[#485259]">Repository</p>
      <p className="break-words text-[14px] font-medium leading-6 text-[#111212]">
        {repository.owner}/{repository.name}
      </p>
    </div>
  );
}

function DescriptorPreview({ isGitLab, target }: Readonly<DescriptorPreviewProps>): JSX.Element {
  const requestShortName: string = isGitLab ? 'MR' : 'PR';
  return (
    <div className="grid gap-4 rounded-lg border border-black/10 bg-[#fbfcfc] p-4">
      <p className="text-[12px] font-medium uppercase text-[#485259]">
        {target.files.length === 1 ? `${requestShortName} file` : `${requestShortName} files`}
      </p>
      {target.files.map(
        (file: GitDescriptorDraftFile): JSX.Element => (
          <div className="grid gap-3" key={file.path}>
            <p className="text-[14px] font-medium leading-6 text-[#111212]">{file.path}</p>
            <OnboardingCommandBlock command={file.content} />
          </div>
        ),
      )}
    </div>
  );
}

function CreatePrButton({ isGitLab, onCreatePr, onPrCreated }: Readonly<CreatePrButtonProps>): JSX.Element {
  return <OpenDescriptorPullRequestButton isGitLab={isGitLab} onCreatePr={onCreatePr} onPrCreated={onPrCreated} />;
}

function usePullRequestStatusPolling(onPrMerged: () => Promise<void>): void {
  useEffect((): (() => void) => {
    let canceled: boolean = false;
    let refreshing: boolean = false;
    const refresh: () => void = (): void => {
      if (canceled || refreshing) {
        return;
      }
      refreshing = true;
      void onPrMerged().finally((): void => {
        refreshing = false;
      });
    };
    const intervalId: number = window.setInterval(refresh, onboardingStatusPollingIntervalMs);
    refresh();
    return (): void => {
      canceled = true;
      window.clearInterval(intervalId);
    };
  }, [onPrMerged]);
}

function readAppFolderLabel(appFolder: string): string {
  return appFolder === '.' ? 'Repository root (.)' : appFolder;
}
