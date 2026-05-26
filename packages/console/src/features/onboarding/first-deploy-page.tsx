import { useMemo, type JSX } from 'react';
import { useLoaderData } from 'react-router';
import { TriangleAlert } from '../../components/ui/icons';
import { FirstDeployHeader, type FirstDeployHeaderCopy } from './first-deploy-header';
import { OnboardingMethodPanel } from './onboarding-method-panel';
import { OnboardingMethodSelector } from './onboarding-method-selector';
import { readConsoleOrigin } from './onboarding-guides';
import {
  readMethodSelectHandler,
  readStepHrefReader,
  useEnsureOnboardingSession,
  useOnboardingRouteNavigation,
  type OnboardingRouteNavigation,
  type OnboardingSessionIssue,
} from './onboarding-navigation';
import { OnboardingOrganizationContextPanel } from './onboarding-organization-context-panel';
import type { OnboardingPageData } from './onboarding-page-data.types';
import type { OnboardingDeployMethod, OnboardingRouteNavigate, OnboardingRouteState } from './onboarding-page.types';
import { OnboardingProcessStepper } from './onboarding-process-stepper';
import type { BrowserConsoleOrganizationIssue } from '../../services/browser-organization-context.service.types';

interface FirstDeployPageProps {
  flowPathname: string;
  headerCopy: FirstDeployHeaderCopy;
  hideBreadcrumbs: boolean;
}

export interface FirstDeployFlowState {
  consoleOrigin: string;
  data: OnboardingPageData;
  flowPathname: string;
  navigate: OnboardingRouteNavigate;
  routeState: OnboardingRouteState;
  sessionIssue: OnboardingSessionIssue | null;
}

interface FirstDeployStandalonePageProps {
  headerCopy: FirstDeployHeaderCopy;
  hideBreadcrumbs: boolean;
  state: FirstDeployFlowState;
}

interface FirstDeployMainPanelProps {
  consoleOrigin: string;
  flowPathname: string;
  navigate: OnboardingRouteNavigate;
  principalEmail: string;
  routeState: OnboardingRouteState;
  selectedOrganizationSlug: string;
}

interface FirstDeployChoicePanelProps {
  onSelect: (method: OnboardingDeployMethod) => void;
}

interface FirstDeploySessionIssueBannerProps {
  issue: OnboardingSessionIssue;
}

interface SelectedOrganizationFirstDeployContentInput {
  consoleOrigin: string;
  data: OnboardingPageData;
  flowPathname: string;
  navigate: OnboardingRouteNavigate;
  routeState: OnboardingRouteState;
  selectedOrganizationSlug: string;
  sessionIssue: OnboardingSessionIssue | null;
}

export function FirstDeployPage({
  flowPathname,
  headerCopy,
  hideBreadcrumbs,
}: Readonly<FirstDeployPageProps>): JSX.Element {
  return (
    <FirstDeployStandalonePage
      headerCopy={headerCopy}
      hideBreadcrumbs={hideBreadcrumbs}
      state={useFirstDeployPageState(flowPathname)}
    />
  );
}

export function FirstDeployFlow({
  consoleOrigin,
  data,
  flowPathname,
  navigate,
  routeState,
  sessionIssue,
}: Readonly<FirstDeployFlowState>): JSX.Element {
  if (data.organizationContext.kind !== 'selected') {
    return renderFirstDeployOrganizationContext(data.organizationContext, data, flowPathname);
  }

  return renderSelectedOrganizationFirstDeployContent({
    consoleOrigin,
    data,
    flowPathname,
    navigate,
    routeState,
    selectedOrganizationSlug: data.organizationContext.selectedOrganizationSlug,
    sessionIssue,
  });
}

export function useFirstDeployPageState(flowPathname: string): FirstDeployFlowState {
  const data: OnboardingPageData = useLoaderData();
  const { navigate, routeState }: OnboardingRouteNavigation = useOnboardingRouteNavigation();
  const consoleOrigin: string = useMemo(readConsoleOrigin, []);
  const sessionIssue: OnboardingSessionIssue | null = useEnsureOnboardingSession(
    data.selectedOrganizationSlug,
    routeState,
    navigate,
  );

  return {
    consoleOrigin,
    data,
    flowPathname,
    navigate,
    routeState,
    sessionIssue,
  };
}

function FirstDeployStandalonePage({
  headerCopy,
  hideBreadcrumbs,
  state,
}: Readonly<FirstDeployStandalonePageProps>): JSX.Element {
  return (
    <main className="min-h-screen bg-[#f5f6f7] text-[#111212]">
      <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-6 px-4 py-6 lg:px-6 lg:py-8">
        <FirstDeployHeader copy={headerCopy} hideBreadcrumbs={hideBreadcrumbs} projectsHref={state.data.projectsHref} />
        <FirstDeployFlow {...state} />
      </div>
    </main>
  );
}

function renderFirstDeployOrganizationContext(
  context: BrowserConsoleOrganizationIssue,
  data: OnboardingPageData,
  flowPathname: string,
): JSX.Element {
  return <OnboardingOrganizationContextPanel context={context} data={data} flowPathname={flowPathname} />;
}

function renderSelectedOrganizationFirstDeployContent(
  input: Readonly<SelectedOrganizationFirstDeployContentInput>,
): JSX.Element {
  return (
    <>
      <OnboardingProcessStepper
        currentStep={input.routeState.step}
        isComplete={input.routeState.deployCompleted}
        readStepHref={readStepHrefReader(input.routeState)}
      />
      {input.sessionIssue !== null ? <FirstDeploySessionIssueBanner issue={input.sessionIssue} /> : null}
      {renderSelectedOrganizationMainPanel(
        input.consoleOrigin,
        input.data,
        input.flowPathname,
        input.navigate,
        input.routeState,
        input.selectedOrganizationSlug,
      )}
    </>
  );
}

function renderSelectedOrganizationMainPanel(
  consoleOrigin: string,
  data: OnboardingPageData,
  flowPathname: string,
  navigate: OnboardingRouteNavigate,
  routeState: OnboardingRouteState,
  selectedOrganizationSlug: string,
): JSX.Element {
  return (
    <FirstDeployMainPanel
      {...readFirstDeployMainPanelProps(
        consoleOrigin,
        data,
        flowPathname,
        navigate,
        routeState,
        selectedOrganizationSlug,
      )}
    />
  );
}

function readFirstDeployMainPanelProps(
  consoleOrigin: string,
  data: OnboardingPageData,
  flowPathname: string,
  navigate: OnboardingRouteNavigate,
  routeState: OnboardingRouteState,
  selectedOrganizationSlug: string,
): FirstDeployMainPanelProps {
  return {
    consoleOrigin,
    flowPathname,
    navigate,
    principalEmail: data.principalEmail,
    routeState,
    selectedOrganizationSlug,
  };
}

function FirstDeploySessionIssueBanner({ issue }: Readonly<FirstDeploySessionIssueBannerProps>): JSX.Element {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-[#f0b4aa] bg-[#fff7f5] p-4 text-[#7a251d]">
      <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" strokeWidth={2.25} />
      <p className="text-[14px] font-medium leading-5">{issue.message}</p>
    </div>
  );
}

function FirstDeployMainPanel({
  consoleOrigin,
  flowPathname,
  navigate,
  principalEmail,
  routeState,
  selectedOrganizationSlug,
}: Readonly<FirstDeployMainPanelProps>): JSX.Element {
  if (routeState.method === undefined) {
    return <FirstDeployChoicePanel onSelect={readMethodSelectHandler(navigate)} />;
  }

  return (
    <section className="min-w-0 rounded-lg border border-black/10 bg-white">
      <OnboardingMethodPanel
        consoleOrigin={consoleOrigin}
        flowPathname={flowPathname}
        navigate={navigate}
        principalEmail={principalEmail}
        routeState={routeState}
        selectedOrganizationSlug={selectedOrganizationSlug}
      />
    </section>
  );
}

function FirstDeployChoicePanel({ onSelect }: Readonly<FirstDeployChoicePanelProps>): JSX.Element {
  return (
    <section className="rounded-lg border border-black/10 bg-white p-5">
      <OnboardingMethodSelector method={undefined} onSelect={onSelect} />
    </section>
  );
}
