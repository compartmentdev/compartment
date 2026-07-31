import {
  compartmentGitLabTokenInvalidErrorCode,
  type CreateGitProviderRegistrationResponse,
  type GitProviderRegistrationSummary,
} from '@compartment/contracts/browser';
import { BrowserApiError } from '../../lib/browser-api';
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent, type JSX, type MutableRefObject } from 'react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { createBrowserGitLabProviderRegistration } from './onboarding-git-api';
import type { OnboardingRouteNavigate } from './onboarding-page.types';
import { GitLabRegistrationChoices } from './onboarding-gitlab-registrations';
import { useGitLabRegistrationSeed } from './onboarding-gitlab-registration-options';
import { GitLabConnectStateValue, type GitLabConnectState } from './onboarding-gitlab-connect-state';
import { readValidGitLabHost } from './onboarding-gitlab-host';

interface GitLabConnectProps {
  navigate: OnboardingRouteNavigate;
  selectedOrganizationSlug: string;
}
interface GitLabConnectStateInput {
  accessToken: string;
  canceledRef: MutableRefObject<boolean>;
  error: string | null;
  hostPristineRef: MutableRefObject<boolean>;
  isSubmitting: boolean;
  props: Readonly<GitLabConnectProps>;
  providerHost: string;
  registrations: GitProviderRegistrationSummary[];
  setAccessToken: (value: string) => void;
  setError: (value: string | null) => void;
  setIsSubmitting: (value: boolean) => void;
  setProviderHost: (value: string) => void;
}
interface GitLabHostSeedState {
  hostPristineRef: MutableRefObject<boolean>;
  providerHost: string;
  registrations: GitProviderRegistrationSummary[];
  setProviderHost: (value: string) => void;
}
export function GitLabConnect(props: Readonly<GitLabConnectProps>): JSX.Element {
  const state: GitLabConnectState = useGitLabConnectState(props);
  return <GitLabConnectForm state={state} />;
}
function GitLabConnectForm({ state }: Readonly<{ state: GitLabConnectState }>): JSX.Element {
  return (
    <form className="grid max-w-md gap-4 p-5" onSubmit={state.onSubmit}>
      <h2 className="text-[24px] font-semibold leading-8">Connect GitLab</h2>
      <GitLabRegistrationChoices onSelect={state.onExistingRegistrationSelected} registrations={state.registrations} />
      <GitLabCredentialFields state={state} />
      {renderGitLabSubmitButton(state.isSubmitting)}
      {state.error !== null ? renderGitLabConnectError(state.error) : null}
    </form>
  );
}
function GitLabCredentialFields({ state }: Readonly<{ state: GitLabConnectState }>): JSX.Element {
  return (
    <>
      <label className="grid gap-2">
        <span>GitLab host</span>
        <Input onChange={state.onProviderHostChange} required value={state.providerHost} />
      </label>
      <label className="grid gap-2">
        <span>Access token</span>
        <Input
          autoComplete="new-password"
          onChange={state.onAccessTokenChange}
          required
          type="password"
          value={state.accessToken}
        />
      </label>
      {renderGitLabTokenHelp(state.providerHost)}
    </>
  );
}
function renderGitLabTokenHelp(providerHost: string): JSX.Element {
  const validHost: string | null = readValidGitLabHost(providerHost);
  if (validHost === null) {
    return <p className="text-[13px] text-[#485259]">Enter a valid GitLab host to create a personal access token.</p>;
  }
  return (
    <p className="text-[13px] text-[#485259]">
      <a
        className="text-foreground underline underline-offset-2"
        href={`https://${validHost}/-/user_settings/personal_access_tokens?name=Compartment&scopes=api`}
        rel="noreferrer"
        target="_blank"
      >
        Create a personal access token
      </a>{' '}
      with the api scope. Your account needs Maintainer access to the repository.
    </p>
  );
}
function useGitLabConnectState(props: Readonly<GitLabConnectProps>): GitLabConnectState {
  const [accessToken, setAccessToken] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const canceledRef: MutableRefObject<boolean> = useCanceledRef();
  const hostSeed: GitLabHostSeedState = useGitLabHostSeed(props, setError);
  return createGitLabConnectState({
    ...hostSeed,
    accessToken,
    canceledRef,
    error,
    isSubmitting,
    props,
    setAccessToken,
    setError,
    setIsSubmitting,
  });
}
function useGitLabHostSeed(
  props: Readonly<GitLabConnectProps>,
  setError: (value: string | null) => void,
): GitLabHostSeedState {
  const [providerHost, setProviderHost] = useState<string>('gitlab.com');
  const hostPristineRef: MutableRefObject<boolean> = useRef<boolean>(true);
  const registrations: GitProviderRegistrationSummary[] = useRegistrationSeed(
    props,
    setProviderHost,
    setError,
    hostPristineRef,
  );
  return { hostPristineRef, providerHost, registrations, setProviderHost };
}
function useRegistrationSeed(
  props: Readonly<GitLabConnectProps>,
  setProviderHost: (value: string) => void,
  setError: (value: string | null) => void,
  hostPristineRef: MutableRefObject<boolean>,
): GitProviderRegistrationSummary[] {
  return useGitLabRegistrationSeed(props.selectedOrganizationSlug, setProviderHost, setError, hostPristineRef);
}
function useCanceledRef(): MutableRefObject<boolean> {
  const canceledRef: MutableRefObject<boolean> = useRef<boolean>(false);
  useEffect((): (() => void) => {
    canceledRef.current = false;
    return (): void => {
      canceledRef.current = true;
    };
  }, []);
  return canceledRef;
}
function createGitLabConnectState(input: GitLabConnectStateInput): GitLabConnectState {
  return new GitLabConnectStateValue({
    accessToken: input.accessToken,
    error: input.error,
    isSubmitting: input.isSubmitting,
    onAccessTokenChange: (event: ChangeEvent<HTMLInputElement>): void =>
      input.setAccessToken(event.currentTarget.value),
    onProviderHostChange: (event: ChangeEvent<HTMLInputElement>): void => {
      input.hostPristineRef.current = false;
      input.setProviderHost(event.currentTarget.value);
    },
    onExistingRegistrationSelected: createExistingRegistrationHandler(input.props),
    onSubmit: createGitLabSubmitHandler(input),
    providerHost: input.providerHost,
    registrations: input.registrations,
  });
}

function createExistingRegistrationHandler(
  props: Readonly<GitLabConnectProps>,
): (registration: GitProviderRegistrationSummary) => void {
  return (registration: GitProviderRegistrationSummary): void => {
    props.navigate({
      gitConnected: true,
      provider: 'gitlab',
      providerHost: registration.providerHost,
      registrationId: registration.registrationId,
    });
  };
}

function createGitLabSubmitHandler(input: GitLabConnectStateInput): (event: FormEvent<HTMLFormElement>) => void {
  return (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    void submitGitLabConnect(
      input.props,
      input.providerHost,
      input.accessToken,
      input.setError,
      input.setIsSubmitting,
      input.canceledRef,
    );
  };
}

async function submitGitLabConnect(
  props: Readonly<GitLabConnectProps>,
  providerHost: string,
  accessToken: string,
  setError: (error: string | null) => void,
  setIsSubmitting: (value: boolean) => void,
  canceledRef: MutableRefObject<boolean>,
): Promise<void> {
  setError(null);
  setIsSubmitting(true);
  try {
    const response: CreateGitProviderRegistrationResponse = await createGitLabRegistration(
      props,
      providerHost,
      accessToken,
    );
    if (!canceledRef.current) navigateToGitLabRepositories(props, response);
  } catch (error) {
    if (!canceledRef.current) {
      setError(readGitLabConnectError(error instanceof Error ? error : new Error('Could not connect GitLab.')));
    }
  } finally {
    if (!canceledRef.current) setIsSubmitting(false);
  }
}

function renderGitLabSubmitButton(isSubmitting: boolean): JSX.Element {
  return (
    <Button disabled={isSubmitting} type="submit">
      {isSubmitting ? 'Connecting…' : 'Continue to repositories'}
    </Button>
  );
}

function navigateToGitLabRepositories(
  props: Readonly<GitLabConnectProps>,
  response: CreateGitProviderRegistrationResponse,
): void {
  props.navigate({
    gitConnected: true,
    provider: 'gitlab',
    providerHost: response.registration.providerHost,
    registrationId: response.registration.registrationId,
  });
}

function renderGitLabConnectError(error: string): JSX.Element {
  return <p className="text-[13px] text-[#b42318]">{error}</p>;
}

function readGitLabConnectError(error: Error): string {
  if (error instanceof BrowserApiError && error.code === compartmentGitLabTokenInvalidErrorCode) {
    return 'GitLab token could not be used. Check the token and try again.';
  }
  return error.message.length > 0 ? error.message : 'Could not connect GitLab.';
}

async function createGitLabRegistration(
  props: Readonly<GitLabConnectProps>,
  providerHost: string,
  accessToken: string,
): Promise<CreateGitProviderRegistrationResponse> {
  const normalizedHost: string | null = readValidGitLabHost(providerHost);
  if (normalizedHost === null) throw new Error('Enter a valid GitLab hostname, without a path.');
  return await createBrowserGitLabProviderRegistration(props.selectedOrganizationSlug, {
    accessToken,
    providerHost: normalizedHost,
  });
}
