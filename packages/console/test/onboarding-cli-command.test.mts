import { describe, expect, it } from 'vitest';
import { readCliInstallerLoginCommand } from '../src/features/onboarding/onboarding-cli-command';

describe('browser onboarding CLI command', (): void => {
  it('keeps custom local console ports when building the CLI API URL', (): void => {
    expect(
      readCliInstallerLoginCommand({
        consoleOrigin: 'http://console.localhost:38080',
        principalEmail: 'admin@example.com',
        selectedOrganizationSlug: 'acme-dev',
        sessionId: 'fdo_123',
      }),
    ).toBe(
      'curl -fsSL https://compartment.dev/install.sh | sh -s -- --init-login --api-url http://127.0.0.1:38080 --email admin@example.com --organization acme-dev --onboarding-session fdo_123',
    );
  });

  it('leaves non-local console origins unchanged', (): void => {
    expect(
      readCliInstallerLoginCommand({
        consoleOrigin: 'https://console.example.com',
        principalEmail: 'admin@example.com',
        selectedOrganizationSlug: 'acme-dev',
        sessionId: 'fdo_123',
      }),
    ).toContain('--api-url https://console.example.com');
  });
});
