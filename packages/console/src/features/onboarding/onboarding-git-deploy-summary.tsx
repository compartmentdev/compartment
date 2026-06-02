import type { JSX } from 'react';
import { defaultCompartmentEnvironmentName } from '@compartment/contracts/browser';
import type { OnboardingRouteState } from './onboarding-page.types';

interface GitDeploySummaryProps {
  routeState: OnboardingRouteState;
}

interface GitSummaryProps {
  branchName: string;
  environmentName: string;
  repositoryLabel: string;
}

interface GitSummaryItemProps {
  label: string;
  value: string;
}

export function GitDeploySummary({ routeState }: Readonly<GitDeploySummaryProps>): JSX.Element {
  return (
    <GitSummary
      branchName={routeState.branchName ?? 'default branch'}
      environmentName={routeState.environmentName ?? defaultCompartmentEnvironmentName}
      repositoryLabel={readGitRepositoryLabel(routeState)}
    />
  );
}

function readGitRepositoryLabel(routeState: OnboardingRouteState): string {
  if (routeState.repositoryOwner === undefined || routeState.repositoryName === undefined) {
    return 'Selected repository';
  }
  return `${routeState.repositoryOwner}/${routeState.repositoryName}`;
}

function GitSummary({ branchName, environmentName, repositoryLabel }: Readonly<GitSummaryProps>): JSX.Element {
  return (
    <div className="grid gap-3 rounded-card border border-black/10 bg-card p-4 sm:grid-cols-2">
      <GitSummaryItem label="Repository" value={repositoryLabel} />
      <GitSummaryItem label="Branch" value={branchName} />
      <GitSummaryItem label="Environment" value={environmentName} />
    </div>
  );
}

function GitSummaryItem({ label, value }: Readonly<GitSummaryItemProps>): JSX.Element {
  return (
    <div>
      <p className="text-[12px] leading-5 text-[#707b82]">{label}</p>
      <p className="break-words text-[13px] font-medium leading-5 text-[#111212]">{value}</p>
    </div>
  );
}
