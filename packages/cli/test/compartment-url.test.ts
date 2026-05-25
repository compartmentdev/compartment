import { describe, expect, it } from 'vitest';
import { buildCompartmentBrowserEntryUrl, buildControlPlaneUrl } from '../src/compartment-url';

describe('compartment browser entry url', (): void => {
  it('appends the browser login path to a compartment origin', (): void => {
    expect(buildCompartmentBrowserEntryUrl('http://console.example.com:39080')).toBe(
      'http://console.example.com:39080/login',
    );
  });

  it('can append a start-onboarding login flag', (): void => {
    expect(
      buildCompartmentBrowserEntryUrl('http://console.example.com:39080', 'admin@example.com', {
        startOnboarding: true,
      }),
    ).toBe('http://console.example.com:39080/login?email=admin%40example.com&start-onboarding');
  });

  it('omits the default port in control plane urls', (): void => {
    expect(buildControlPlaneUrl('https', 'console.example.com', 443)).toBe('https://console.example.com');
  });

  it('includes non-default ports in control plane urls', (): void => {
    expect(buildControlPlaneUrl('http', 'console.localhost', 9443)).toBe('http://console.localhost:9443');
  });
});
