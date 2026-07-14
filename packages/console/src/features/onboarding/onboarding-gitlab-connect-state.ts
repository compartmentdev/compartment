import type { GitProviderRegistrationSummary } from '@compartment/contracts/browser';
import type { ChangeEvent, FormEvent } from 'react';

export interface GitLabConnectState {
  accessToken: string;
  error: string | null;
  isSubmitting: boolean;
  onAccessTokenChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onProviderHostChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onExistingRegistrationSelected: (registration: GitProviderRegistrationSummary) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  providerHost: string;
  registrations: GitProviderRegistrationSummary[];
}

export class GitLabConnectStateValue implements GitLabConnectState {
  public constructor(private readonly state: Readonly<GitLabConnectState>) {}
  public get accessToken(): string {
    return this.state.accessToken;
  }
  public get error(): string | null {
    return this.state.error;
  }
  public get isSubmitting(): boolean {
    return this.state.isSubmitting;
  }
  public get onAccessTokenChange(): (event: ChangeEvent<HTMLInputElement>) => void {
    return this.state.onAccessTokenChange;
  }
  public get onProviderHostChange(): (event: ChangeEvent<HTMLInputElement>) => void {
    return this.state.onProviderHostChange;
  }
  public get onExistingRegistrationSelected(): (registration: GitProviderRegistrationSummary) => void {
    return this.state.onExistingRegistrationSelected;
  }
  public get onSubmit(): (event: FormEvent<HTMLFormElement>) => void {
    return this.state.onSubmit;
  }
  public get providerHost(): string {
    return this.state.providerHost;
  }
  public get registrations(): GitProviderRegistrationSummary[] {
    return this.state.registrations;
  }
}
