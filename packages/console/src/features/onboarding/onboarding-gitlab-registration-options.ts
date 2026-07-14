import type {
  GitProviderRegistrationListResponse,
  GitProviderRegistrationSummary,
} from '@compartment/contracts/browser';
import { useCallback, useEffect, useState, type MutableRefObject } from 'react';
import { listBrowserGitProviderRegistrations } from './onboarding-git-api';

export function useGitLabRegistrationSeed(
  organizationSlug: string,
  setProviderHost: (value: string) => void,
  setError: (value: string | null) => void,
  hostPristineRef: MutableRefObject<boolean>,
): GitProviderRegistrationSummary[] {
  const seedProviderHost: (value: string) => void = useCallback(
    (value: string): void => {
      if (hostPristineRef.current) setProviderHost(value);
    },
    [hostPristineRef, setProviderHost],
  );
  const handleFailure: () => void = useCallback((): void => {
    setError('Could not load existing GitLab registrations. You can still enter a host and token.');
  }, [setError]);
  return useGitLabRegistrations(organizationSlug, seedProviderHost, handleFailure);
}

function useGitLabRegistrations(
  organizationSlug: string,
  seedProviderHost: (value: string) => void,
  onFailure: () => void,
): GitProviderRegistrationSummary[] {
  const [registrations, setRegistrations] = useState<GitProviderRegistrationSummary[]>([]);
  useEffect((): (() => void) => {
    let canceled: boolean = false;
    void listBrowserGitProviderRegistrations(organizationSlug)
      .then((response: GitProviderRegistrationListResponse): void => {
        if (canceled) return;
        const matches: GitProviderRegistrationSummary[] = response.registrations.filter(
          (registration: GitProviderRegistrationSummary): boolean => registration.providerType === 'gitlab',
        );
        setRegistrations(matches);
        if (matches[0] !== undefined) seedProviderHost(matches[0].providerHost);
      })
      .catch((): void => onFailure());
    return (): void => {
      canceled = true;
    };
  }, [onFailure, organizationSlug, seedProviderHost]);
  return registrations;
}
