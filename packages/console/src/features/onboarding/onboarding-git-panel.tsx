import { useCallback, type JSX } from 'react';
import { handleRepositorySelected, type GitRepositorySelectionResult } from './onboarding-git-actions';
import { GitConnectLink } from './onboarding-git-connect';
import { GitDescriptorCreationStep } from './onboarding-git-descriptor-step';
import { GitLoadingStep } from './onboarding-git-loading-step';
import { GitDeployStep } from './onboarding-git-result';
import { GitRepositoryPicker } from './onboarding-git-repository-picker';
import { useGitOnboardingState, type GitOnboardingState } from './onboarding-git-state';
import type { GitConnectFormInput, OnboardingRouteNavigate, OnboardingRouteState } from './onboarding-page.types';
import { readSelectedRepositoryRoutePatch } from './onboarding-git-route-patch';

interface GitOnboardingPanelProps {
  consoleOrigin: string;
  navigate: OnboardingRouteNavigate;
  routeState: OnboardingRouteState;
  selectedOrganizationSlug: string;
}

interface GitPrepareStepProps extends GitOnboardingPanelProps {
  isConnected: boolean;
  state: GitOnboardingState;
}

interface GitOnboardingStepContentProps extends GitOnboardingPanelProps {
  state: GitOnboardingState;
}

interface GitRepositoryLoadStepProps {
  state: Pick<GitOnboardingState, 'reloadRepositories' | 'repositoryLoadStatus'>;
}

export function GitOnboardingPanel(props: Readonly<GitOnboardingPanelProps>): JSX.Element {
  const state: GitOnboardingState = useGitOnboardingState({
    initialBranchName: props.routeState.branchName,
    initialEnvironmentName: props.routeState.environmentName,
    registrationId: props.routeState.registrationId,
    repositoryOwner: props.routeState.repositoryOwner,
    sessionId: props.routeState.sessionId,
    selectedOrganizationSlug: props.selectedOrganizationSlug,
    selectedRepositoryId: props.routeState.repositoryId,
  });

  return <GitOnboardingStepContent {...props} state={state} />;
}

function GitOnboardingStepContent(props: Readonly<GitOnboardingStepContentProps>): JSX.Element {
  const onDeployCompleted: () => void = useCallback((): void => {
    props.navigate({ deployCompleted: true });
  }, [props.navigate]);

  if (props.routeState.step === 'prepare') {
    return <GitPrepareStep {...props} isConnected={props.routeState.gitConnected} />;
  }
  if (props.routeState.step === 'verify') {
    return (
      <GitDescriptorCreationStep
        navigate={props.navigate}
        routeState={props.routeState}
        selectedOrganizationSlug={props.selectedOrganizationSlug}
        state={props.state}
      />
    );
  }

  return renderGitDeployStep(props, onDeployCompleted);
}

function renderGitDeployStep(props: Readonly<GitOnboardingStepContentProps>, onCompleted: () => void): JSX.Element {
  return (
    <GitDeployStep
      onCompleted={onCompleted}
      routeState={props.routeState}
      selectedOrganizationSlug={props.selectedOrganizationSlug}
    />
  );
}

function GitPrepareStep(props: Readonly<GitPrepareStepProps>): JSX.Element {
  if (!props.isConnected) {
    return (
      <GitConnectLink
        consoleOrigin={props.consoleOrigin}
        gitAccountDiscoverySessionId={props.routeState.gitAccountDiscoverySessionId}
        gitAccountDiscoveryToken={props.routeState.gitAccountDiscoveryToken}
        selectedOrganizationSlug={props.selectedOrganizationSlug}
        sessionId={props.routeState.sessionId}
      />
    );
  }

  return <GitConnectedPrepareStep {...props} />;
}

function GitConnectedPrepareStep(props: Readonly<GitPrepareStepProps>): JSX.Element {
  if (props.state.formInput === null) {
    return <GitRepositoryLoadStep state={props.state} />;
  }

  return (
    <GitRepositoryPicker
      formInput={props.state.formInput}
      onFormChange={props.state.onFormChange}
      onReloadRepositories={props.state.reloadRepositories}
      onRepositoryChange={props.state.onRepositoryChange}
      onRepositorySelected={async (formInput: GitConnectFormInput): Promise<void> => {
        await onRepositorySelected(props, formInput);
      }}
      repositoryLoadStatus={props.state.repositoryLoadStatus}
      repositoryOptions={props.state.repositoryOptions}
    />
  );
}

function GitRepositoryLoadStep({ state }: Readonly<GitRepositoryLoadStepProps>): JSX.Element {
  if (state.repositoryLoadStatus === 'loading' || state.repositoryLoadStatus === 'idle') {
    return <GitLoadingStep label="Repositories" value="Loading repositories" />;
  }
  if (state.repositoryLoadStatus === 'failed') {
    return (
      <GitLoadingStep
        label="Repositories"
        onRefresh={state.reloadRepositories}
        state="error"
        value="GitHub installation cannot be read. Reconnect GitHub."
      />
    );
  }

  return (
    <GitLoadingStep
      label="Repositories"
      onRefresh={state.reloadRepositories}
      state="error"
      value="No repositories are available for this GitHub installation"
    />
  );
}

async function onRepositorySelected(
  props: Readonly<GitPrepareStepProps>,
  formInput: GitConnectFormInput,
): Promise<void> {
  const result: GitRepositorySelectionResult = await handleRepositorySelected(
    props.selectedOrganizationSlug,
    props.state,
    formInput,
  );
  if (result.kind === 'connected') {
    props.navigate({
      ...readSelectedRepositoryRoutePatch(formInput),
      descriptorPath: result.descriptorPath,
      sourceId: result.connection.sourceId,
      step: 'deploy',
      syncTaskId: result.connection.syncTaskId,
    });
    return;
  }

  props.navigate({
    ...readSelectedRepositoryRoutePatch(formInput),
    step: 'verify',
  });
}
