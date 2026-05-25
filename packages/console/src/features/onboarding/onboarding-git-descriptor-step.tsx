import type {
  GitDescriptorPullRequestResponse,
  GitDescriptorPullRequestStatusResponse,
} from '@compartment/contracts/browser';
import { useCallback, type JSX } from 'react';
import {
  connectSelectedGitSource,
  handleCreatePullRequest,
  handlePullRequestRefresh,
  type GitPullRequestRefreshContext,
} from './onboarding-git-actions';
import {
  readDescriptorTargetOptions,
  readPendingPullRequestTarget,
  useDescriptorTargetsLoader,
} from './onboarding-git-descriptor-resume';
import { GitDescriptorPrStep } from './onboarding-git-descriptor-pr';
import { GitLoadingStep } from './onboarding-git-loading-step';
import type { GitSourceConnectionResult } from './onboarding-git-source-connection';
import type { GitOnboardingState } from './onboarding-git-state';
import type {
  GitConnectFormInput,
  GitDescriptorTargetOption,
  OnboardingRouteNavigate,
  OnboardingRouteState,
} from './onboarding-page.types';
import {
  readMergedPullRequestRoutePatch,
  readPullRequestRefreshContext,
  type GitPullRequestMergeInput,
} from './onboarding-git-route-patch';

interface GitDescriptorCreationStepProps {
  navigate: OnboardingRouteNavigate;
  routeState: OnboardingRouteState;
  selectedOrganizationSlug: string;
  state: GitOnboardingState;
}

interface GitDescriptorReadyStepProps extends GitDescriptorCreationStepProps {
  formInput: GitConnectFormInput;
  target: GitDescriptorTargetOption;
}

export function GitDescriptorCreationStep(props: Readonly<GitDescriptorCreationStepProps>): JSX.Element {
  useDescriptorTargetsLoader({
    descriptorPath: props.routeState.descriptorPath,
    formInput: props.state.formInput,
    loadDescriptorTargets: props.state.loadDescriptorTargets,
    projectName: props.routeState.projectName,
    pullRequestState: props.routeState.pullRequestState,
    target: props.state.target,
  });
  const formInput: GitConnectFormInput | null = props.state.formInput;
  if (formInput === null) {
    return <GitLoadingStep label="Descriptor" value="Loading descriptor plan" />;
  }
  const target: GitDescriptorTargetOption | null = props.state.target ?? readPendingPullRequestTarget(props.routeState);
  if (target === null) {
    return <GitLoadingStep label="Descriptor" value="Loading descriptor plan" />;
  }

  return <GitDescriptorReadyStep {...props} formInput={formInput} target={target} />;
}

function GitDescriptorReadyStep(props: Readonly<GitDescriptorReadyStepProps>): JSX.Element {
  const onPrCreated: (response: GitDescriptorPullRequestResponse) => void = usePrCreatedHandler(props);
  const onCreatePr: () => Promise<GitDescriptorPullRequestResponse> = useCreatePrHandler(props);
  const onPrMerged: () => Promise<void> = usePrMergedHandler(props);

  return (
    <GitDescriptorPrStep
      formInput={props.formInput}
      isPrPending={props.routeState.pullRequestState === 'pending'}
      onCreatePr={onCreatePr}
      onPrCreated={onPrCreated}
      onPrMerged={onPrMerged}
      onTargetChange={props.state.onTargetChange}
      target={props.target}
      targetOptions={readDescriptorTargetOptions(props.state.targetOptions, props.target)}
    />
  );
}

function usePrCreatedHandler(
  props: Readonly<GitDescriptorReadyStepProps>,
): (response: GitDescriptorPullRequestResponse) => void {
  return useCallback(
    (response: GitDescriptorPullRequestResponse): void => {
      props.navigate({
        descriptorPath: response.descriptorPath,
        projectName: props.target.projectName,
        pullRequestNumber: response.pullRequestNumber,
        pullRequestState: 'pending',
        pullRequestStatusToken: response.statusToken,
        step: 'verify',
      });
    },
    [props.navigate, props.target.projectName],
  );
}

function useCreatePrHandler(
  props: Readonly<GitDescriptorReadyStepProps>,
): () => Promise<GitDescriptorPullRequestResponse> {
  return useCallback(async (): Promise<GitDescriptorPullRequestResponse> => {
    return await handleCreatePullRequest(props.selectedOrganizationSlug, props.formInput, props.target);
  }, [props.formInput, props.selectedOrganizationSlug, props.target]);
}

function usePrMergedHandler(props: Readonly<GitDescriptorReadyStepProps>): () => Promise<void> {
  const { descriptorPath, pullRequestNumber, pullRequestStatusToken } = props.routeState;
  return useCallback(async (): Promise<void> => {
    const input: GitPullRequestMergeInput = {
      descriptorPath,
      formInput: props.formInput,
      pullRequestNumber,
      pullRequestStatusToken,
      selectedOrganizationSlug: props.selectedOrganizationSlug,
    };
    await handlePrMerged(input, props.navigate);
  }, [
    descriptorPath,
    props.formInput,
    props.navigate,
    props.selectedOrganizationSlug,
    pullRequestNumber,
    pullRequestStatusToken,
  ]);
}

async function handlePrMerged(
  input: Readonly<GitPullRequestMergeInput>,
  navigate: OnboardingRouteNavigate,
): Promise<void> {
  const context: GitPullRequestRefreshContext | null = readPullRequestRefreshContext(input);
  if (context === null) {
    return;
  }
  const response: GitDescriptorPullRequestStatusResponse = await handlePullRequestRefresh(
    input.selectedOrganizationSlug,
    input.formInput,
    context,
  );
  if (response.state !== 'merged') {
    return;
  }
  await connectMergedPullRequestSource(input, context, navigate);
}

async function connectMergedPullRequestSource(
  input: Readonly<GitPullRequestMergeInput>,
  context: GitPullRequestRefreshContext,
  navigate: OnboardingRouteNavigate,
): Promise<void> {
  const connection: GitSourceConnectionResult = await connectSelectedGitSource(
    input.selectedOrganizationSlug,
    input.formInput,
    context.descriptorPath,
  );
  navigate(readMergedPullRequestRoutePatch(context, connection));
}
