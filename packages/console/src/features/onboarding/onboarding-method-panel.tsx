import { useCallback, type JSX } from 'react';
import { CliOnboardingPanel } from './onboarding-cli-panel';
import { GitOnboardingPanel } from './onboarding-git-panel';
import type { OnboardingProcessStep, OnboardingRouteNavigate, OnboardingRouteState } from './onboarding-page.types';

interface OnboardingMethodPanelProps {
  consoleOrigin: string;
  flowPathname: string;
  principalEmail: string;
  selectedOrganizationSlug: string;
  navigate: OnboardingRouteNavigate;
  routeState: OnboardingRouteState;
}

interface CliOnboardingPanelAdapterProps {
  consoleOrigin: string;
  flowPathname: string;
  navigate: OnboardingRouteNavigate;
  routeState: OnboardingRouteState;
  principalEmail: string;
  selectedOrganizationSlug: string;
  sessionId: string | undefined;
  step: OnboardingProcessStep;
}

interface GitOnboardingPanelAdapterProps {
  consoleOrigin: string;
  navigate: OnboardingRouteNavigate;
  routeState: OnboardingRouteState;
  selectedOrganizationSlug: string;
}

interface CliOnboardingPanelHandlers {
  onDeployCompleted: () => void;
  onDeployStarted: () => void;
  onLoginConfirmed: () => void;
}

class CliOnboardingPanelHandlerSet implements CliOnboardingPanelHandlers {
  constructor(
    public readonly onDeployCompleted: () => void,
    public readonly onDeployStarted: () => void,
    public readonly onLoginConfirmed: () => void,
  ) {}
}

export function OnboardingMethodPanel(props: Readonly<OnboardingMethodPanelProps>): JSX.Element {
  return props.routeState.method === 'git' ? (
    <GitOnboardingPanelAdapter
      consoleOrigin={props.consoleOrigin}
      navigate={props.navigate}
      routeState={props.routeState}
      selectedOrganizationSlug={props.selectedOrganizationSlug}
    />
  ) : (
    <CliOnboardingPanelAdapter
      consoleOrigin={props.consoleOrigin}
      flowPathname={props.flowPathname}
      navigate={props.navigate}
      principalEmail={props.principalEmail}
      routeState={props.routeState}
      selectedOrganizationSlug={props.selectedOrganizationSlug}
      sessionId={props.routeState.sessionId}
      step={props.routeState.step}
    />
  );
}

function GitOnboardingPanelAdapter({
  consoleOrigin,
  navigate,
  routeState,
  selectedOrganizationSlug,
}: Readonly<GitOnboardingPanelAdapterProps>): JSX.Element {
  return (
    <GitOnboardingPanel
      consoleOrigin={consoleOrigin}
      navigate={navigate}
      routeState={routeState}
      selectedOrganizationSlug={selectedOrganizationSlug}
    />
  );
}

function CliOnboardingPanelAdapter({
  consoleOrigin,
  flowPathname,
  navigate,
  principalEmail,
  routeState,
  selectedOrganizationSlug,
  sessionId,
  step,
}: Readonly<CliOnboardingPanelAdapterProps>): JSX.Element {
  const handlers: CliOnboardingPanelHandlers = useCliOnboardingPanelHandlers(navigate, routeState.deployCompleted);

  return (
    <CliOnboardingPanel
      consoleOrigin={consoleOrigin}
      flowPathname={flowPathname}
      onDeployCompleted={handlers.onDeployCompleted}
      onDeployStarted={handlers.onDeployStarted}
      onLoginConfirmed={handlers.onLoginConfirmed}
      principalEmail={principalEmail}
      selectedOrganizationSlug={selectedOrganizationSlug}
      sessionId={sessionId}
      step={step}
    />
  );
}

function useCliOnboardingPanelHandlers(
  navigate: OnboardingRouteNavigate,
  deployCompleted: boolean,
): CliOnboardingPanelHandlers {
  const onDeployCompleted: () => void = useCallback((): void => {
    if (!deployCompleted) {
      navigate({ deployCompleted: true });
    }
  }, [deployCompleted, navigate]);
  const onDeployStarted: () => void = useCallback((): void => {
    navigate({ step: 'deploy' });
  }, [navigate]);
  const onLoginConfirmed: () => void = useCallback((): void => {
    navigate({ step: 'verify' });
  }, [navigate]);

  return new CliOnboardingPanelHandlerSet(onDeployCompleted, onDeployStarted, onLoginConfirmed);
}
