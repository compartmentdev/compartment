import { useEffect, useState, type JSX } from 'react';
import { browserProjectCreatePathname } from '../../browser-public-paths';
import type { OnboardingProcessStep } from './onboarding-page.types';
import { readCliInstallerLoginCommand, readCliLoginCommand } from './onboarding-cli-command';
import { readOnboardingDeployStatusState } from './onboarding-deploy-status-state';
import {
  CliLoginModeSelector,
  readCliLoginHeaderCopy,
  type CliLoginHeaderCopy,
  type CliLoginMode,
} from './onboarding-cli-login-mode-selector';
import { OnboardingCommandBlock, OnboardingStatus } from './onboarding-shared';
import {
  refreshCliLoginStatus,
  type CliWaitingDeployStatus,
  useCliDeployStatusNavigation,
  useCliLoginStatusNavigation,
  useCliWaitingDeployStatus,
} from './onboarding-cli-status';

interface CliOnboardingPanelProps {
  consoleOrigin: string;
  flowPathname: string;
  onDeployCompleted: () => void;
  onDeployStarted: () => void;
  onLoginConfirmed: () => void;
  principalEmail: string;
  selectedOrganizationSlug: string;
  sessionId: string | undefined;
  step: OnboardingProcessStep;
}

interface CliLoginStepProps {
  consoleOrigin: string;
  flowPathname: string;
  onLoginConfirmed: () => void;
  principalEmail: string;
  selectedOrganizationSlug: string;
  sessionId: string | undefined;
}

interface CliDeployCommandStepProps {
  onDeployStarted: () => void;
  selectedOrganizationSlug: string;
  sessionId: string | undefined;
}

interface CliLoginCommandContentProps {
  consoleOrigin: string;
  mode: CliLoginMode;
  principalEmail: string;
  selectedOrganizationSlug: string;
  sessionId: string | undefined;
}

type CliWaitingStepProps = Pick<
  CliOnboardingPanelProps,
  'onDeployCompleted' | 'selectedOrganizationSlug' | 'sessionId'
>;

export function CliOnboardingPanel(props: Readonly<CliOnboardingPanelProps>): JSX.Element {
  if (props.step === 'deploy') {
    return <CliWaitingStep {...readCliWaitingStepProps(props)} />;
  }
  if (props.step === 'verify') {
    return <CliDeployCommandStep {...readCliDeployCommandStepProps(props)} />;
  }

  return <CliLoginStep {...readCliLoginStepProps(props)} />;
}

function readCliLoginStepProps(props: Readonly<CliOnboardingPanelProps>): CliLoginStepProps {
  return {
    consoleOrigin: props.consoleOrigin,
    flowPathname: props.flowPathname,
    onLoginConfirmed: props.onLoginConfirmed,
    principalEmail: props.principalEmail,
    selectedOrganizationSlug: props.selectedOrganizationSlug,
    sessionId: props.sessionId,
  };
}

function readCliDeployCommandStepProps(props: Readonly<CliOnboardingPanelProps>): CliDeployCommandStepProps {
  return {
    onDeployStarted: props.onDeployStarted,
    selectedOrganizationSlug: props.selectedOrganizationSlug,
    sessionId: props.sessionId,
  };
}

function readCliWaitingStepProps(props: Readonly<CliOnboardingPanelProps>): CliWaitingStepProps {
  return {
    onDeployCompleted: props.onDeployCompleted,
    selectedOrganizationSlug: props.selectedOrganizationSlug,
    sessionId: props.sessionId,
  };
}

function CliLoginStep(props: Readonly<CliLoginStepProps>): JSX.Element {
  const showInstallChoice: boolean = props.flowPathname === browserProjectCreatePathname;
  const defaultMode: CliLoginMode = readDefaultCliLoginMode(props.flowPathname);
  const [mode, setMode] = useState<CliLoginMode>(defaultMode);
  const selectedMode: CliLoginMode = showInstallChoice ? mode : 'install';
  const headerCopy: CliLoginHeaderCopy = readCliLoginHeaderCopy(selectedMode);

  useEffect((): void => {
    setMode(defaultMode);
  }, [defaultMode]);
  useCliLoginStatusNavigation(props.selectedOrganizationSlug, props.sessionId, props.onLoginConfirmed);

  return (
    <div className="grid gap-5 p-5">
      <CliLoginHeader copy={headerCopy} />
      {showInstallChoice ? <CliLoginModeSelector mode={selectedMode} onSelect={setMode} /> : null}
      <CliLoginCommandContent
        consoleOrigin={props.consoleOrigin}
        mode={selectedMode}
        principalEmail={props.principalEmail}
        selectedOrganizationSlug={props.selectedOrganizationSlug}
        sessionId={props.sessionId}
      />
      <OnboardingStatus label="CLI login" onRefresh={readCliLoginRefreshHandler(props)} value="Waiting for CLI login" />
    </div>
  );
}

function readDefaultCliLoginMode(flowPathname: string): CliLoginMode {
  return flowPathname === browserProjectCreatePathname ? 'installed' : 'install';
}

function readCliLoginRefreshHandler(props: Readonly<CliLoginStepProps>): () => Promise<void> {
  return async (): Promise<void> => {
    await refreshCliLoginStatus(props.selectedOrganizationSlug, props.sessionId, props.onLoginConfirmed);
  };
}

function CliLoginCommandContent({
  consoleOrigin,
  mode,
  principalEmail,
  selectedOrganizationSlug,
  sessionId,
}: Readonly<CliLoginCommandContentProps>): JSX.Element {
  if (sessionId === undefined) {
    return <OnboardingSessionPreparingStatus />;
  }

  return (
    <OnboardingCommandBlock
      command={readCliLoginCommandForMode(mode, {
        consoleOrigin,
        principalEmail,
        selectedOrganizationSlug,
        sessionId,
      })}
    />
  );
}

function readCliLoginCommandForMode(
  mode: CliLoginMode,
  props: Readonly<Omit<CliLoginCommandContentProps, 'mode'>>,
): string {
  return mode === 'installed'
    ? readCliLoginCommand({
        consoleOrigin: props.consoleOrigin,
        principalEmail: props.principalEmail,
        selectedOrganizationSlug: props.selectedOrganizationSlug,
        sessionId: props.sessionId!,
      })
    : readCliInstallerLoginCommand({
        consoleOrigin: props.consoleOrigin,
        principalEmail: props.principalEmail,
        selectedOrganizationSlug: props.selectedOrganizationSlug,
        sessionId: props.sessionId!,
      });
}

function CliLoginHeader({ copy }: Readonly<{ copy: CliLoginHeaderCopy }>): JSX.Element {
  return (
    <div>
      <h2 className="text-[24px] font-semibold leading-8">{copy.title}</h2>
      <p className="mt-2 max-w-2xl text-[14px] leading-6 text-[#485259]">{copy.description}</p>
    </div>
  );
}

function CliDeployCommandStep({
  onDeployStarted,
  selectedOrganizationSlug,
  sessionId,
}: Readonly<CliDeployCommandStepProps>): JSX.Element {
  useCliDeployStatusNavigation(selectedOrganizationSlug, sessionId, onDeployStarted);

  return (
    <div className="grid gap-5 p-5">
      <CliDeployHeader />
      {sessionId === undefined ? (
        <OnboardingSessionPreparingStatus />
      ) : (
        <div className="grid gap-3">
          <OnboardingCommandBlock command="compartment init" />
          <OnboardingCommandBlock command="compartment deploy" />
        </div>
      )}
    </div>
  );
}

function CliDeployHeader(): JSX.Element {
  return (
    <div>
      <h2 className="text-[24px] font-semibold leading-8">Deploy from CLI</h2>
      <p className="mt-2 max-w-2xl text-[14px] leading-6 text-[#485259]">
        Go to your project directory, then run these commands one at a time.
      </p>
    </div>
  );
}

function CliWaitingStep({
  onDeployCompleted,
  selectedOrganizationSlug,
  sessionId,
}: Readonly<CliWaitingStepProps>): JSX.Element {
  const status: CliWaitingDeployStatus = useCliWaitingDeployStatus(selectedOrganizationSlug, sessionId);
  useDeployCompletedNavigation(status.response?.status, onDeployCompleted);

  return (
    <div className="grid gap-5 p-5">
      <h2 className="text-[24px] font-semibold leading-8">Waiting for first deploy</h2>
      <OnboardingStatus
        label="Deployment"
        onRefresh={status.refresh}
        selectedOrganizationSlug={selectedOrganizationSlug}
        showOpenProjectsOnSuccess={true}
        state={readOnboardingDeployStatusState(status.response?.status)}
        value={status.response?.statusText ?? 'Waiting for first deploy'}
      />
    </div>
  );
}

function useDeployCompletedNavigation(status: string | undefined, onDeployCompleted: () => void): void {
  useEffect((): void => {
    if (status === 'deploy_succeeded') {
      onDeployCompleted();
    }
  }, [onDeployCompleted, status]);
}

function OnboardingSessionPreparingStatus(): JSX.Element {
  return (
    <OnboardingStatus
      isActive={false}
      label="Onboarding session"
      onRefresh={noopOnboardingRefresh}
      value="Preparing session-bound CLI command"
    />
  );
}

function noopOnboardingRefresh(): void {
  return undefined;
}
