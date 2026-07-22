import { describe, expect, it } from 'vitest';
import type { InstallCommandOptions } from '../src/commands/install/install.command.types';
import { readManagedDomainRequestedLabelSource } from '../src/commands/install/install.command.managed-domain';
import { resolveKubernetesInstallCommandOptions } from '../src/commands/install/install.command.validation';

describe('production install option validation', (): void => {
  it('defaults to a managed domain and the production broker', (): void => {
    expect(
      resolveKubernetesInstallCommandOptions({ output: 'json', values: 'compartment-values.yaml' }, '/kubeconfig'),
    ).toMatchObject({
      brokerUrl: 'https://broker.compartment.run',
      domainMode: 'managed',
    });
  });

  it('accepts an explicit managed-domain broker override', (): void => {
    expect(
      resolveKubernetesInstallCommandOptions(
        {
          brokerUrl: 'https://broker.example.test/',
          managedDomain: true,
          output: 'json',
          values: 'compartment-values.yaml',
        },
        '/kubeconfig',
      ).brokerUrl,
    ).toBe('https://broker.example.test');
  });

  it.each([
    'https://user:secret@broker.example.test',
    'https://broker.example.test/api',
    'https://broker.example.test?tenant=acme',
    'https://broker.example.test#fragment',
  ])('rejects broker URL %s because the broker contract requires an origin', (brokerUrl: string): void => {
    expect((): void => {
      resolveKubernetesInstallCommandOptions(
        {
          brokerUrl,
          managedDomain: true,
          output: 'json',
          values: 'compartment-values.yaml',
        },
        '/kubeconfig',
      );
    }).toThrow('Managed domain broker URL must be an absolute HTTP(S) origin');
  });

  it('rejects managed-domain and custom-domain selection together', (): void => {
    expect((): void => {
      resolveKubernetesInstallCommandOptions(
        {
          baseDomain: 'apps.example.com',
          managedDomain: true,
          output: 'json',
          values: 'compartment-values.yaml',
        },
        '/kubeconfig',
      );
    }).toThrow('Choose either --base-domain or --managed-domain');
  });

  it.each(['foo..example.com', '-foo.example.com', 'apps.example.com,images.api.tag=evil'])(
    'rejects invalid base domain %s before invoking Helm',
    (baseDomain: string): void => {
      expect((): void => {
        resolveKubernetesInstallCommandOptions(
          createOptions(baseDomain, `https://console.${baseDomain}`),
          '/kubeconfig',
        );
      }).toThrow('--base-domain must be a valid DNS base domain without a port.');
    },
  );

  it('refuses to send first-owner credentials over cleartext for a public domain', (): void => {
    expect((): void => {
      resolveKubernetesInstallCommandOptions(
        createOptions('apps.example.com', 'http://console.apps.example.com'),
        '/kubeconfig',
      );
    }).toThrow('--api-url must use HTTPS outside the reserved .localhost development domain.');
  });

  it('requires the Console host to match an explicit base domain', (): void => {
    expect((): void => {
      resolveKubernetesInstallCommandOptions(
        createOptions('apps.example.com', 'https://console.other.example.com'),
        '/kubeconfig',
      );
    }).toThrow('--api-url must use the control-plane host console.apps.example.com.');
  });

  it('keeps reserved localhost HTTP available to the k3d production-install boundary', (): void => {
    expect(
      resolveKubernetesInstallCommandOptions(
        createOptions('compartment.localhost', 'http://console.compartment.localhost:18080'),
        '/kubeconfig',
      ).apiUrl,
    ).toBe('http://console.compartment.localhost:18080');
  });

  it('rejects an invalid explicit organization slug before deployment', (): void => {
    expect((): void => {
      resolveKubernetesInstallCommandOptions(
        {
          organizationSlug: 'Acme Dev',
          output: 'json',
          values: 'compartment-values.yaml',
        },
        '/kubeconfig',
      );
    }).toThrow('Organization slug must use lowercase letters, digits, and single hyphens.');
  });

  it('validates the exact truncated managed-domain label source', (): void => {
    expect((): void => {
      readManagedDomainRequestedLabelSource(`${'-'.repeat(128)}a`, undefined);
    }).toThrow('Organization slug must contain at least one letter or digit.');
    expect(readManagedDomainRequestedLabelSource(`${'a'.repeat(128)}ignored`, undefined)).toBe('a'.repeat(128));
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
