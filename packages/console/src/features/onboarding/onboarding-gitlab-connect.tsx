import {
  compartmentGitLabTokenInvalidErrorCode,
  type CreateGitLabProviderRegistrationResponse,
} from '@compartment/contracts/browser';
import { BrowserApiError } from '../../lib/browser-api';
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent, type JSX, type MutableRefObject } from 'react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { createBrowserGitLabProviderRegistration } from './onboarding-git-api';
import type { OnboardingRouteNavigate } from './onboarding-page.types';

interface GitLabConnectProps {
  initialProviderHost: string;
  navigate: OnboardingRouteNavigate;
  selectedOrganizationSlug: string;
}
interface GitLabConnectState {
  accessToken: string;
  error: string | null;
  isSubmitting: boolean;
  onAccessTokenChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onProviderHostChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  providerHost: string;
}

class GitLabConnectStateValue implements GitLabConnectState {
  public constructor(private readonly state: Readonly<GitLabConnectState>) {}

  public get accessToken(): string {
    return this.state.accessToken;
  }
  public get error(): string | null {
    return this.state.error;
  }
  public get onAccessTokenChange(): (event: ChangeEvent<HTMLInputElement>) => void {
    return this.state.onAccessTokenChange;
  }
  public get onProviderHostChange(): (event: ChangeEvent<HTMLInputElement>) => void {
    return this.state.onProviderHostChange;
  }
  public get onSubmit(): (event: FormEvent<HTMLFormElement>) => void {
    return this.state.onSubmit;
  }
  public get providerHost(): string {
    return this.state.providerHost;
  }
  public get isSubmitting(): boolean {
    return this.state.isSubmitting;
  }
}

export function GitLabConnect(props: Readonly<GitLabConnectProps>): JSX.Element {
  const state: GitLabConnectState = useGitLabConnectState(props);
  return <GitLabConnectForm state={state} />;
}

function GitLabConnectForm({ state }: Readonly<{ state: GitLabConnectState }>): JSX.Element {
  return (
    <form className="grid max-w-md gap-4 p-5" onSubmit={state.onSubmit}>
      <h2 className="text-[24px] font-semibold leading-8">Connect GitLab</h2>
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
      {renderGitLabSubmitButton(state.isSubmitting)}
      {state.error !== null ? renderGitLabConnectError(state.error) : null}
    </form>
  );
}

function renderGitLabTokenHelp(providerHost: string): JSX.Element {
  return (
    <p className="text-[13px] text-[#485259]">
      <a
        className="text-foreground underline underline-offset-2"
        href={`https://${providerHost}/-/user_settings/personal_access_tokens?name=Compartment&scopes=api`}
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
  const [providerHost, setProviderHost] = useState<string>(props.initialProviderHost);
  const [accessToken, setAccessToken] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const canceledRef: MutableRefObject<boolean> = useRef<boolean>(false);
  useEffect((): (() => void) => {
    canceledRef.current = false;
    return (): void => {
      canceledRef.current = true;
    };
  }, []);
  return new GitLabConnectStateValue({
    accessToken,
    error,
    isSubmitting,
    onAccessTokenChange: (event: ChangeEvent<HTMLInputElement>): void => setAccessToken(event.currentTarget.value),
    onProviderHostChange: (event: ChangeEvent<HTMLInputElement>): void => setProviderHost(event.currentTarget.value),
    onSubmit: (event: FormEvent<HTMLFormElement>): void => {
      event.preventDefault();
      void submitGitLabConnect(props, providerHost, accessToken, setError, setIsSubmitting, canceledRef);
    },
    providerHost,
  });
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
    const response: CreateGitLabProviderRegistrationResponse = await createGitLabRegistration(
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
  response: CreateGitLabProviderRegistrationResponse,
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
): Promise<CreateGitLabProviderRegistrationResponse> {
  return await createBrowserGitLabProviderRegistration(props.selectedOrganizationSlug, { accessToken, providerHost });
}
