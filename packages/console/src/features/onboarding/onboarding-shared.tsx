import { useState, type JSX } from 'react';
import { CircleCheck, LoaderCircle, Play, RefreshCw, TriangleAlert } from '../../components/ui/icons';
import { Button, buttonVariants } from '../../components/ui/button';
import { buildBrowserConsoleProjectsHref } from '../console/console-hrefs';

export { OnboardingCommandBlock } from './onboarding-command-block';

export type OnboardingStatusState = 'active' | 'error' | 'idle' | 'success';

interface OnboardingStatusProps {
  isActive?: boolean | undefined;
  label: string;
  onRefresh?: (() => Promise<void> | void) | undefined;
  selectedOrganizationSlug?: string | undefined;
  showOpenProjectsOnSuccess?: boolean | undefined;
  state?: OnboardingStatusState | undefined;
  value: string;
}

interface OnboardingStatusMarkerProps {
  state: OnboardingStatusState;
}

interface OnboardingStatusBodyProps {
  label: string;
  state: OnboardingStatusState;
  value: string;
}

interface OnboardingRefreshState {
  isRefreshing: boolean;
  onRefresh: () => void;
}

interface OnboardingStatusButtonProps {
  state: OnboardingRefreshState;
}

interface OnboardingStatusActionProps {
  refreshState: OnboardingRefreshState | null;
  selectedOrganizationSlug: string | undefined;
  showOpenProjectsOnSuccess: boolean;
  state: OnboardingStatusState;
}

interface OnboardingOpenProjectsButtonProps {
  selectedOrganizationSlug: string | undefined;
}

const refreshSpinMinimumMs: number = 700;

export function OnboardingStatus({
  isActive = true,
  label,
  onRefresh,
  selectedOrganizationSlug,
  showOpenProjectsOnSuccess = false,
  state,
  value,
}: Readonly<OnboardingStatusProps>): JSX.Element {
  const refreshState: OnboardingRefreshState | null = useOnboardingRefreshState(onRefresh);
  const markerState: OnboardingStatusState = state ?? (isActive ? 'active' : 'idle');
  return (
    <div className="flex w-full max-w-full flex-col gap-3 overflow-hidden rounded-card border border-black/10 bg-card p-4 sm:flex-row sm:items-start sm:justify-between">
      <OnboardingStatusBody label={label} state={markerState} value={value} />
      <OnboardingStatusAction
        refreshState={refreshState}
        selectedOrganizationSlug={selectedOrganizationSlug}
        showOpenProjectsOnSuccess={showOpenProjectsOnSuccess}
        state={markerState}
      />
    </div>
  );
}

function OnboardingStatusBody({ label, state, value }: Readonly<OnboardingStatusBodyProps>): JSX.Element {
  return (
    <div className="grid min-w-0 flex-1 grid-cols-[36px_minmax(0,1fr)] gap-3">
      <OnboardingStatusMarker state={state} />
      <div className="min-w-0">
        <p className="text-[12px] font-medium uppercase text-[#485259]">{label}</p>
        <p className="mt-1 min-w-0 break-words text-[14px] font-medium leading-6 text-[#111212] [overflow-wrap:anywhere]">
          {value}
        </p>
      </div>
    </div>
  );
}

function useOnboardingRefreshState(onRefresh: (() => Promise<void> | void) | undefined): OnboardingRefreshState | null {
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  if (onRefresh === undefined) {
    return null;
  }
  return {
    isRefreshing,
    onRefresh: (): void => {
      const startedAt: number = Date.now();
      setIsRefreshing(true);
      void Promise.resolve(onRefresh()).finally((): void => {
        window.setTimeout((): void => {
          setIsRefreshing(false);
        }, readRemainingRefreshSpinMs(startedAt));
      });
    },
  };
}

function readRemainingRefreshSpinMs(startedAt: number): number {
  return Math.max(0, refreshSpinMinimumMs - (Date.now() - startedAt));
}

function OnboardingStatusAction({
  refreshState,
  selectedOrganizationSlug,
  showOpenProjectsOnSuccess,
  state,
}: Readonly<OnboardingStatusActionProps>): JSX.Element | null {
  if (state === 'success' && showOpenProjectsOnSuccess) {
    return <OnboardingOpenProjectsButton selectedOrganizationSlug={selectedOrganizationSlug} />;
  }
  if (refreshState === null) {
    return null;
  }

  return <OnboardingStatusButton state={refreshState} />;
}

function OnboardingStatusButton({ state }: Readonly<OnboardingStatusButtonProps>): JSX.Element {
  return (
    <Button
      className="w-fit shrink-0"
      disabled={state.isRefreshing}
      onClick={state.onRefresh}
      type="button"
      variant="outline"
    >
      <RefreshCw
        aria-hidden="true"
        className={state.isRefreshing ? 'animate-spin [animation-duration:700ms]' : undefined}
        size={14}
      />
      Refresh status
    </Button>
  );
}

function OnboardingOpenProjectsButton({
  selectedOrganizationSlug,
}: Readonly<OnboardingOpenProjectsButtonProps>): JSX.Element {
  return (
    <a
      className={buttonVariants({ className: 'w-fit no-underline' })}
      href={buildBrowserConsoleProjectsHref(selectedOrganizationSlug ?? null)}
    >
      <Play aria-hidden="true" size={15} />
      Open Projects
    </a>
  );
}

function OnboardingStatusMarker({ state }: Readonly<OnboardingStatusMarkerProps>): JSX.Element {
  if (state === 'success') {
    return (
      <span className="flex size-9 items-center justify-center rounded-icon bg-[#eef8f1] text-[#2f7d45]">
        <CircleCheck aria-hidden="true" className="size-5" strokeWidth={2.5} />
      </span>
    );
  }
  if (state === 'error') {
    return (
      <span className="flex size-9 items-center justify-center rounded-icon bg-[#fff3f0] text-[#b13a2f]">
        <TriangleAlert aria-hidden="true" className="size-5" strokeWidth={2.5} />
      </span>
    );
  }
  if (state === 'active') {
    return (
      <span className="flex size-9 items-center justify-center rounded-icon bg-[#f4f9ff] text-[#3480c8]">
        <LoaderCircle aria-hidden="true" className="size-5 animate-spin" strokeWidth={2.5} />
      </span>
    );
  }

  return <span className="flex size-9 items-center justify-center rounded-icon border border-[#3480c8]/40 bg-card" />;
}
