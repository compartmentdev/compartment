import { useEffect, useState, type Dispatch, type JSX, type SetStateAction } from 'react';
import type {
  GitHubAccountDiscoveryAccount,
  GitHubAccountDiscoveryResultResponse,
} from '@compartment/contracts/browser';
import { Button } from '../../components/ui/button';
import { GitBranch, LoaderCircle } from '../../components/ui/icons';
import { readBrowserGitHubAccountDiscoveryResult } from './onboarding-git-api';
import { GitAccountPicker, type GitAccountDiscoveryLoadStatus } from './onboarding-git-account-picker';
import {
  readAccountSelectedHandler,
  readConnectClickHandler,
  type GitHubAccountInstallStatus,
  type GitHubConnectStartStatus,
} from './onboarding-git-connect-actions';
import { GitConnectHeader } from './onboarding-git-connect-header';

interface GitConnectLinkProps {
  consoleOrigin: string;
  gitAccountDiscoverySessionId: string | undefined;
  gitAccountDiscoveryToken: string | undefined;
  selectedOrganizationSlug: string;
  sessionId: string | undefined;
}

interface UseGitAccountDiscoveryResultInput {
  gitAccountDiscoverySessionId: string | undefined;
  gitAccountDiscoveryToken: string | undefined;
  selectedOrganizationSlug: string;
  setAccounts: (accounts: GitHubAccountDiscoveryAccount[]) => void;
  setStatus: (status: GitAccountDiscoveryLoadStatus) => void;
}

interface GitAccountDiscoveryResultLoadInput {
  gitAccountDiscoverySessionId: string;
  gitAccountDiscoveryToken: string;
  selectedOrganizationSlug: string;
  setAccounts: (accounts: GitHubAccountDiscoveryAccount[]) => void;
  setStatus: (status: GitAccountDiscoveryLoadStatus) => void;
}

interface GitAccountDiscoveryLoadState {
  accounts: GitHubAccountDiscoveryAccount[];
  status: GitAccountDiscoveryLoadStatus;
}

interface GitConnectLinkContentProps extends GitConnectLinkProps {
  accounts: GitHubAccountDiscoveryAccount[];
  status: GitAccountDiscoveryLoadStatus;
}

interface GitConnectStartButtonProps {
  consoleOrigin: string;
  isLoading: boolean;
  selectedOrganizationSlug: string;
  sessionId: string | undefined;
  setStatus: Dispatch<SetStateAction<GitHubConnectStartStatus>>;
}

export function GitConnectLink(props: Readonly<GitConnectLinkProps>): JSX.Element {
  const loadState: GitAccountDiscoveryLoadState = useGitAccountDiscoveryLoadState(props);

  return <GitConnectLinkContent {...props} {...loadState} />;
}

function useGitAccountDiscoveryLoadState({
  gitAccountDiscoverySessionId,
  gitAccountDiscoveryToken,
  selectedOrganizationSlug,
}: Readonly<GitConnectLinkProps>): GitAccountDiscoveryLoadState {
  const [accounts, setAccounts] = useState<GitHubAccountDiscoveryAccount[]>([]);
  const [status, setStatus] = useState<GitAccountDiscoveryLoadStatus>('idle');

  useGitAccountDiscoveryResult({
    gitAccountDiscoverySessionId,
    gitAccountDiscoveryToken,
    selectedOrganizationSlug,
    setAccounts,
    setStatus,
  });

  return { accounts, status };
}

function GitConnectLinkContent(props: Readonly<GitConnectLinkContentProps>): JSX.Element {
  if (hasGitAccountDiscoveryResult(props.gitAccountDiscoverySessionId, props.gitAccountDiscoveryToken)) {
    return <GitConnectAccountPicker {...props} />;
  }

  return (
    <GitConnectPrompt
      consoleOrigin={props.consoleOrigin}
      selectedOrganizationSlug={props.selectedOrganizationSlug}
      sessionId={props.sessionId}
    />
  );
}

function GitConnectAccountPicker({
  accounts,
  selectedOrganizationSlug,
  sessionId,
  status,
}: Readonly<GitConnectLinkContentProps>): JSX.Element {
  const [installStatus, setInstallStatus] = useState<GitHubAccountInstallStatus>('idle');
  const [installingAccountLogin, setInstallingAccountLogin] = useState<string | null>(null);
  return (
    <GitAccountPicker
      accounts={accounts}
      installError={installStatus === 'failed'}
      installingAccountLogin={installingAccountLogin}
      onAccountSelected={readAccountSelectedHandler(
        selectedOrganizationSlug,
        sessionId,
        setInstallingAccountLogin,
        setInstallStatus,
      )}
      status={status}
    />
  );
}

function hasGitAccountDiscoveryResult(
  gitAccountDiscoverySessionId: string | undefined,
  gitAccountDiscoveryToken: string | undefined,
): boolean {
  return gitAccountDiscoverySessionId !== undefined && gitAccountDiscoveryToken !== undefined;
}

function GitConnectPrompt(
  props: Readonly<Pick<GitConnectLinkProps, 'consoleOrigin' | 'selectedOrganizationSlug' | 'sessionId'>>,
): JSX.Element {
  const { consoleOrigin, selectedOrganizationSlug, sessionId } = props;
  const [status, setStatus] = useState<GitHubConnectStartStatus>('idle');
  const isLoading: boolean = status === 'loading';

  return (
    <div className="grid gap-5 p-5">
      <GitConnectHeader />
      <GitConnectStartButton
        consoleOrigin={consoleOrigin}
        isLoading={isLoading}
        selectedOrganizationSlug={selectedOrganizationSlug}
        sessionId={sessionId}
        setStatus={setStatus}
      />
      {status === 'failed' ? (
        <p className="text-[13px] leading-5 text-[#b42318]">Could not open GitHub. Try again.</p>
      ) : null}
    </div>
  );
}

function GitConnectStartButton({
  consoleOrigin,
  isLoading,
  selectedOrganizationSlug,
  sessionId,
  setStatus,
}: Readonly<GitConnectStartButtonProps>): JSX.Element {
  return (
    <Button
      className="w-fit"
      disabled={sessionId === undefined || isLoading}
      onClick={readConnectClickHandler(consoleOrigin, selectedOrganizationSlug, sessionId, setStatus)}
      type="button"
    >
      {isLoading ? (
        <LoaderCircle aria-hidden="true" className="animate-spin" size={15} />
      ) : (
        <GitBranch aria-hidden="true" size={15} />
      )}
      {isLoading ? 'Opening GitHub' : 'Choose GitHub account'}
    </Button>
  );
}

function useGitAccountDiscoveryResult(input: UseGitAccountDiscoveryResultInput): void {
  const { gitAccountDiscoverySessionId, gitAccountDiscoveryToken, selectedOrganizationSlug, setAccounts, setStatus } =
    input;

  useEffect((): (() => void) | undefined => {
    if (gitAccountDiscoverySessionId === undefined || gitAccountDiscoveryToken === undefined) {
      return undefined;
    }

    return startGitAccountDiscoveryResultLoad({
      gitAccountDiscoverySessionId,
      gitAccountDiscoveryToken,
      selectedOrganizationSlug,
      setAccounts,
      setStatus,
    });
  }, [gitAccountDiscoverySessionId, gitAccountDiscoveryToken, selectedOrganizationSlug, setAccounts, setStatus]);
}

function startGitAccountDiscoveryResultLoad(input: Readonly<GitAccountDiscoveryResultLoadInput>): () => void {
  let canceled: boolean = false;
  input.setStatus('loading');
  void readBrowserGitHubAccountDiscoveryResult(input.selectedOrganizationSlug, {
    resultToken: input.gitAccountDiscoveryToken,
    sessionId: input.gitAccountDiscoverySessionId,
  })
    .then((result: GitHubAccountDiscoveryResultResponse): void => {
      handleLoadedGitAccounts(input, result, canceled);
    })
    .catch((): void => {
      if (!canceled) {
        input.setStatus('failed');
      }
    });

  return (): void => {
    canceled = true;
  };
}

function handleLoadedGitAccounts(
  input: Readonly<GitAccountDiscoveryResultLoadInput>,
  result: GitHubAccountDiscoveryResultResponse,
  canceled: boolean,
): void {
  if (canceled) {
    return;
  }
  input.setAccounts(result.accounts);
  input.setStatus('ready');
}
