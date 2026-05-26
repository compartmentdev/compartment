import type { JSX } from 'react';
import type {
  GitHubAccountDiscoveryAccount,
  GitHubAccountDiscoveryAppInstallationStatus,
} from '@compartment/contracts/browser';
import { LoaderCircle, UserRound, Users, type LucideIcon } from '../../components/ui/icons';

export type GitAccountDiscoveryLoadStatus = 'failed' | 'idle' | 'loading' | 'ready';

interface GitAccountPickerProps {
  accounts: GitHubAccountDiscoveryAccount[];
  installError: boolean;
  installingAccountLogin: string | null;
  onAccountSelected: (account: GitHubAccountDiscoveryAccount) => void;
  status: GitAccountDiscoveryLoadStatus;
}

interface GitAccountListProps {
  accounts: GitHubAccountDiscoveryAccount[];
  installingAccountLogin: string | null;
  onAccountSelected: (account: GitHubAccountDiscoveryAccount) => void;
}

interface GitAccountListItemProps {
  account: GitHubAccountDiscoveryAccount;
  installingAccountLogin: string | null;
  onAccountSelected: (account: GitHubAccountDiscoveryAccount) => void;
}

interface GitAccountInstallActionProps {
  account: GitHubAccountDiscoveryAccount;
  installingAccountLogin: string | null;
}

interface GitAccountAvatarProps {
  account: GitHubAccountDiscoveryAccount;
}

export function GitAccountPicker({
  accounts,
  installError,
  installingAccountLogin,
  onAccountSelected,
  status,
}: Readonly<GitAccountPickerProps>): JSX.Element {
  return (
    <div className="grid gap-5 p-5">
      <div>
        <h2 className="text-[24px] font-semibold leading-8">Choose GitHub account</h2>
        <p className="mt-2 max-w-2xl text-[14px] leading-6 text-[#485259]">
          Select the personal account or organization that owns the repository. If Compartment is already installed for
          that account, continue to repository selection. Otherwise GitHub will open the app installation page.
        </p>
      </div>
      {renderGitAccountPickerContent(status, accounts, installingAccountLogin, onAccountSelected)}
      {installError ? <div className="text-[14px] text-[#b42318]">Could not open GitHub. Try again.</div> : null}
    </div>
  );
}

function renderGitAccountPickerContent(
  status: GitAccountDiscoveryLoadStatus,
  accounts: GitHubAccountDiscoveryAccount[],
  installingAccountLogin: string | null,
  onAccountSelected: (account: GitHubAccountDiscoveryAccount) => void,
): JSX.Element {
  if (status === 'loading' || status === 'idle') {
    return <GitAccountLoading />;
  }
  if (status === 'failed') {
    return <GitAccountLoadFailure />;
  }

  return (
    <GitAccountList
      accounts={accounts}
      installingAccountLogin={installingAccountLogin}
      onAccountSelected={onAccountSelected}
    />
  );
}

function GitAccountLoading(): JSX.Element {
  return (
    <div className="flex items-center gap-2 text-[14px] text-[#485259]">
      <LoaderCircle aria-hidden="true" className="animate-spin" size={16} />
      Loading GitHub accounts
    </div>
  );
}

function GitAccountLoadFailure(): JSX.Element {
  return <div className="text-[14px] text-[#b42318]">GitHub account discovery failed. Try again.</div>;
}

function GitAccountList({
  accounts,
  installingAccountLogin,
  onAccountSelected,
}: Readonly<GitAccountListProps>): JSX.Element {
  return (
    <div className="grid max-w-2xl overflow-hidden rounded-[8px] border border-[#d8dde2] bg-white">
      {accounts.map(
        (account: GitHubAccountDiscoveryAccount): JSX.Element => (
          <GitAccountListItem
            account={account}
            installingAccountLogin={installingAccountLogin}
            key={`${account.type}:${account.login}`}
            onAccountSelected={onAccountSelected}
          />
        ),
      )}
    </div>
  );
}

function GitAccountListItem({
  account,
  installingAccountLogin,
  onAccountSelected,
}: Readonly<GitAccountListItemProps>): JSX.Element {
  return (
    <button
      className="flex items-center gap-3 border-b border-[#e6eaee] px-4 py-3 text-left last:border-b-0 hover:bg-[#f7f9fb]"
      disabled={installingAccountLogin !== null}
      onClick={(): void => {
        onAccountSelected(account);
      }}
      type="button"
    >
      <GitAccountAvatar account={account} />
      <span className="text-[15px] font-medium text-[#14191f]">{account.login}</span>
      <GitAccountInstallAction account={account} installingAccountLogin={installingAccountLogin} />
    </button>
  );
}

function GitAccountInstallAction({
  account,
  installingAccountLogin,
}: Readonly<GitAccountInstallActionProps>): JSX.Element {
  if (installingAccountLogin === account.login) {
    return (
      <span className="ml-auto inline-flex items-center gap-2 text-[13px] text-[#485259]">
        <LoaderCircle aria-hidden="true" className="animate-spin" size={14} />
        {readGitAccountLoadingLabel(account.appInstallationStatus)}
      </span>
    );
  }

  return (
    <span className="ml-auto text-[13px] text-[#485259]">
      {readGitAccountActionLabel(account.appInstallationStatus)}
    </span>
  );
}

function GitAccountAvatar({ account }: Readonly<GitAccountAvatarProps>): JSX.Element {
  if (account.avatarUrl !== null) {
    return <img alt="" className="h-8 w-8 rounded-[6px] border border-[#d8dde2]" src={account.avatarUrl} />;
  }

  const Icon: LucideIcon = account.type === 'organization' ? Users : UserRound;
  return (
    <span className="grid h-8 w-8 place-items-center rounded-[6px] border border-[#d8dde2] bg-[#f4f6f8] text-[#485259]">
      <Icon aria-hidden="true" size={16} />
    </span>
  );
}

function readGitAccountActionLabel(status: GitHubAccountDiscoveryAppInstallationStatus): string {
  return status === 'installed' ? 'Open repositories' : 'Install app';
}

function readGitAccountLoadingLabel(status: GitHubAccountDiscoveryAppInstallationStatus): string {
  return status === 'installed' ? 'Continuing' : 'Opening GitHub';
}
