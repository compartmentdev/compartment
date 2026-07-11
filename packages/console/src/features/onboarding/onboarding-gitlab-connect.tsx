import type { CreateGitLabProviderRegistrationResponse } from '@compartment/contracts/browser';
import { useState, type ChangeEvent, type FormEvent, type JSX } from 'react';
import { Button } from '../../components/ui/button';
import { createBrowserGitLabProviderRegistration } from './onboarding-git-api';
import type { OnboardingRouteNavigate } from './onboarding-page.types';

interface GitLabConnectProps {
  initialProviderHost: string;
  navigate: OnboardingRouteNavigate;
  selectedOrganizationSlug: string;
}
interface GitLabConnectState {
  accessToken: string;
  error: boolean;
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
  public get error(): boolean {
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
        <input onChange={state.onProviderHostChange} required value={state.providerHost} />
      </label>
      <label className="grid gap-2">
        <span>Access token</span>
        <input onChange={state.onAccessTokenChange} required type="password" value={state.accessToken} />
      </label>
      <p className="text-[13px] text-[#485259]">The token needs the api scope and Maintainer access.</p>
      <Button type="submit">Continue to repositories</Button>
      {state.error ? <p className="text-[13px] text-[#b42318]">Could not connect GitLab. Re-enter the token.</p> : null}
    </form>
  );
}

function useGitLabConnectState(props: Readonly<GitLabConnectProps>): GitLabConnectState {
  const [providerHost, setProviderHost] = useState<string>(props.initialProviderHost);
  const [accessToken, setAccessToken] = useState<string>('');
  const [error, setError] = useState<boolean>(false);
  return new GitLabConnectStateValue({
    accessToken,
    error,
    onAccessTokenChange: (event: ChangeEvent<HTMLInputElement>): void => setAccessToken(event.currentTarget.value),
    onProviderHostChange: (event: ChangeEvent<HTMLInputElement>): void => setProviderHost(event.currentTarget.value),
    onSubmit: (event: FormEvent<HTMLFormElement>): void => {
      event.preventDefault();
      void submitGitLabConnect(props, providerHost, accessToken, setError);
    },
    providerHost,
  });
}

async function submitGitLabConnect(
  props: Readonly<GitLabConnectProps>,
  providerHost: string,
  accessToken: string,
  setError: (error: boolean) => void,
): Promise<void> {
  setError(false);
  try {
    const response: CreateGitLabProviderRegistrationResponse = await createBrowserGitLabProviderRegistration(
      props.selectedOrganizationSlug,
      { accessToken, providerHost },
    );
    props.navigate({
      gitConnected: true,
      provider: 'gitlab',
      providerHost: response.registration.providerHost,
      registrationId: response.registration.registrationId,
    });
  } catch {
    setError(true);
  }
}
