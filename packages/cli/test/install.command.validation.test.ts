import { describe, expect, it } from 'vitest';
import type { InstallCommandOptions } from '../src/commands/install/install.command.types';
import { resolveKubernetesInstallCommandOptions } from '../src/commands/install/install.command.validation';

describe('production install option validation', (): void => {
  it.each(['foo..example.com', '-foo.example.com', 'apps.example.com,images.api.tag=evil'])(
    'rejects invalid base domain %s before invoking Helm',
    (baseDomain: string): void => {
      expect((): void => {
        resolveKubernetesInstallCommandOptions(createOptions(baseDomain, `https://console.${baseDomain}`));
      }).toThrow('--base-domain must be a valid DNS base domain without a port.');
    },
  );

  it('refuses to send first-owner credentials over cleartext for a public domain', (): void => {
    expect((): void => {
      resolveKubernetesInstallCommandOptions(createOptions('apps.example.com', 'http://console.apps.example.com'));
    }).toThrow('--api-url must use HTTPS outside the reserved .localhost development domain.');
  });

  it('keeps reserved localhost HTTP available to the k3d production-install boundary', (): void => {
    expect(
      resolveKubernetesInstallCommandOptions(
        createOptions('compartment.localhost', 'http://console.compartment.localhost:18080'),
      ).apiUrl,
    ).toBe('http://console.compartment.localhost:18080');
  });
});

function createOptions(baseDomain: string, apiUrl: string): InstallCommandOptions {
  return {
    apiUrl,
    baseDomain,
    output: 'json',
    values: 'compartment-values.yaml',
  };
}
