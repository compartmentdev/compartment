import { describe, expect, it } from 'vitest';
import {
  buildFirstDeployOnboardingSessionClearedConfig,
  buildLoggedInConfig,
  buildOrganizationSelectionConfig,
} from '../src/store/config.mutations';
import type { CliConfig } from '../src/store/config.types';
import { createCliOrganizationFixture } from './cli-test.fixtures';

describe('config mutations', (): void => {
  it('stores a first-deploy onboarding session with the login remote', (): void => {
    expect(
      buildLoggedInConfig(
        {},
        'default',
        'https://api.example.com',
        'owner@example.com',
        'session_123',
        undefined,
        'fdo_123',
      ),
    ).toEqual({
      currentRemote: 'default',
      remotes: {
        default: {
          apiUrl: 'https://api.example.com',
          firstDeployOnboardingSessionId: 'fdo_123',
          principalEmail: 'owner@example.com',
          sessionToken: 'session_123',
        },
      },
    });
  });

  it('stores organization selection on the selected remote only', (): void => {
    const config: CliConfig = {
      currentRemote: 'lab',
      remotes: {
        eu: {
          apiUrl: 'https://eu.example.com',
          currentOrganization: createCliOrganizationFixture({
            id: 'org_eu',
            name: 'Europe',
            slug: 'europe',
          }),
          sessionToken: 'eu-session',
        },
        lab: {
          apiUrl: 'https://lab.example.com',
          currentOrganization: createCliOrganizationFixture({
            id: 'org_lab',
            name: 'Lab',
            slug: 'lab',
          }),
          sessionToken: 'lab-session',
        },
      },
    };

    expect(
      buildOrganizationSelectionConfig(
        config,
        'eu',
        createCliOrganizationFixture({
          id: 'org_next',
          name: 'Europe Next',
          slug: 'europe-next',
        }),
      ),
    ).toEqual({
      currentRemote: 'eu',
      remotes: {
        eu: {
          apiUrl: 'https://eu.example.com',
          currentOrganization: {
            id: 'org_next',
            name: 'Europe Next',
            slug: 'europe-next',
          },
          sessionToken: 'eu-session',
        },
        lab: {
          apiUrl: 'https://lab.example.com',
          currentOrganization: {
            id: 'org_lab',
            name: 'Lab',
            slug: 'lab',
          },
          sessionToken: 'lab-session',
        },
      },
    });
  });

  it('clears a matching first-deploy onboarding session from the selected remote', (): void => {
    const config: CliConfig = {
      currentRemote: 'default',
      remotes: {
        default: {
          apiUrl: 'https://api.example.com',
          firstDeployOnboardingSessionId: 'fdo_123',
          principalEmail: 'owner@example.com',
          sessionToken: 'session_123',
        },
        lab: {
          apiUrl: 'https://lab.example.com',
          firstDeployOnboardingSessionId: 'fdo_lab',
          principalEmail: 'lab@example.com',
          sessionToken: 'session_lab',
        },
      },
    };

    expect(buildFirstDeployOnboardingSessionClearedConfig(config, 'default', 'fdo_123')).toEqual({
      currentRemote: 'default',
      remotes: {
        default: {
          apiUrl: 'https://api.example.com',
          principalEmail: 'owner@example.com',
          sessionToken: 'session_123',
        },
        lab: {
          apiUrl: 'https://lab.example.com',
          firstDeployOnboardingSessionId: 'fdo_lab',
          principalEmail: 'lab@example.com',
          sessionToken: 'session_lab',
        },
      },
    });
  });

  it('keeps a first-deploy onboarding session when the expected session does not match', (): void => {
    const config: CliConfig = {
      currentRemote: 'default',
      remotes: {
        default: {
          apiUrl: 'https://api.example.com',
          firstDeployOnboardingSessionId: 'fdo_123',
          sessionToken: 'session_123',
        },
      },
    };

    expect(buildFirstDeployOnboardingSessionClearedConfig(config, 'default', 'fdo_other')).toBe(config);
  });
});
