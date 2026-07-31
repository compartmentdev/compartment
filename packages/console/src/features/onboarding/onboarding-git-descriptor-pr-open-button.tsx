import { useState, type JSX } from 'react';
import type { GitDescriptorPullRequestResponse } from '@compartment/contracts/browser';
import { Button } from '../../components/ui/button';
import { GitBranch, LoaderCircle } from '../../components/ui/icons';
import type { OnboardingGitRequestTerms } from './onboarding-git-provider.types';

type DescriptorPullRequestOpenStatus = 'failed' | 'idle' | 'loading';

interface OpenDescriptorPullRequestButtonProps {
  request: OnboardingGitRequestTerms;
  onCreatePr: () => Promise<GitDescriptorPullRequestResponse>;
  onPrCreated: (response: GitDescriptorPullRequestResponse) => void;
}

interface DescriptorPullRequestOpenButtonProps {
  request: OnboardingGitRequestTerms;
  state: DescriptorPullRequestOpenButtonState;
}

interface DescriptorPullRequestOpenButtonState {
  onClick: () => void;
  status: DescriptorPullRequestOpenStatus;
}

class DescriptorPullRequestOpenButtonStateValue implements DescriptorPullRequestOpenButtonState {
  public constructor(
    public readonly status: DescriptorPullRequestOpenStatus,
    public readonly onClick: () => void,
  ) {}
}

export function OpenDescriptorPullRequestButton({
  request,
  onCreatePr,
  onPrCreated,
}: Readonly<OpenDescriptorPullRequestButtonProps>): JSX.Element {
  const state: DescriptorPullRequestOpenButtonState = useDescriptorPullRequestOpenButtonState(onCreatePr, onPrCreated);

  return (
    <div className="grid gap-3">
      {state.status === 'failed' ? (
        <p className="text-[13px] leading-5 text-[#b42318]">Could not create {request.name}. Try again.</p>
      ) : null}
      <DescriptorPullRequestOpenButton request={request} state={state} />
    </div>
  );
}

function DescriptorPullRequestOpenButton({
  request,
  state,
}: Readonly<DescriptorPullRequestOpenButtonProps>): JSX.Element {
  const isLoading: boolean = state.status === 'loading';
  return (
    <Button className="w-fit" disabled={isLoading} onClick={state.onClick} type="button">
      {isLoading ? (
        <LoaderCircle aria-hidden="true" className="animate-spin" size={15} />
      ) : (
        <GitBranch aria-hidden="true" size={15} />
      )}
      {isLoading ? `Creating ${request.name}` : `Open ${request.name}`}
    </Button>
  );
}

function useDescriptorPullRequestOpenButtonState(
  onCreatePr: () => Promise<GitDescriptorPullRequestResponse>,
  onPrCreated: (response: GitDescriptorPullRequestResponse) => void,
): DescriptorPullRequestOpenButtonState {
  const [status, setStatus] = useState<DescriptorPullRequestOpenStatus>('idle');
  return new DescriptorPullRequestOpenButtonStateValue(status, (): void => {
    void handleCreatePullRequest(onCreatePr, onPrCreated, setStatus);
  });
}

async function handleCreatePullRequest(
  onCreatePr: () => Promise<GitDescriptorPullRequestResponse>,
  onPrCreated: (response: GitDescriptorPullRequestResponse) => void,
  setStatus: (status: DescriptorPullRequestOpenStatus) => void,
): Promise<void> {
  const pullRequestWindow: Window | null = window.open('about:blank', '_blank');
  if (pullRequestWindow === null) {
    setStatus('failed');
    return;
  }
  setStatus('loading');
  try {
    await createAndOpenPullRequest(onCreatePr, onPrCreated, pullRequestWindow);
    setStatus('idle');
  } catch {
    pullRequestWindow.close();
    setStatus('failed');
  }
}

async function createAndOpenPullRequest(
  onCreatePr: () => Promise<GitDescriptorPullRequestResponse>,
  onPrCreated: (response: GitDescriptorPullRequestResponse) => void,
  pullRequestWindow: Window,
): Promise<void> {
  const response: GitDescriptorPullRequestResponse = await onCreatePr();
  openPullRequestWindow(pullRequestWindow, response.pullRequestUrl);
  onPrCreated(response);
}

function openPullRequestWindow(pullRequestWindow: Window, pullRequestUrl: string): void {
  pullRequestWindow.opener = null;
  pullRequestWindow.location.href = pullRequestUrl;
}
