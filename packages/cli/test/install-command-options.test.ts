import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveInstallManagedDomainBrokerUrl } from '../src/commands/install/install.command.options';
import { buildInitialInstallValues } from '../src/services/kubernetes-install-state.service';
import type { KubernetesInstallDeploymentInput } from '../src/services/kubernetes-install.service.types';

describe('managed-domain broker URL resolution', (): void => {
  afterEach((): void => {
    vi.unstubAllEnvs();
  });

  it('maps the production default through command input and initial Helm values', (): void => {
    vi.stubEnv('COMPARTMENT_MANAGED_DOMAIN_BROKER_URL', undefined);
    const brokerUrl: string = resolveInstallManagedDomainBrokerUrl(undefined);

    expect(brokerUrl).toBe('https://broker.compartment.run');
    expect(
      buildInitialInstallValues(managedDeploymentInput(brokerUrl), 'install-token', 'installation-123').platform
        .managedDomainBrokerUrl,
    ).toBe('https://broker.compartment.run');
  });

  it('uses the environment URL instead of the default', (): void => {
    expect(
      resolveInstallManagedDomainBrokerUrl(undefined, {
        COMPARTMENT_MANAGED_DOMAIN_BROKER_URL: 'https://broker.environment.example/',
      }),
    ).toBe('https://broker.environment.example');
  });

  it('uses the flag URL instead of the environment URL', (): void => {
    expect(
      resolveInstallManagedDomainBrokerUrl('https://broker.flag.example/', {
        COMPARTMENT_MANAGED_DOMAIN_BROKER_URL: 'https://broker.environment.example',
      }),
    ).toBe('https://broker.flag.example');
  });

  it('rejects an explicitly empty or whitespace-only URL', (): void => {
    for (const brokerUrl of ['', '   ']) {
      expect((): string => resolveInstallManagedDomainBrokerUrl(brokerUrl, {})).toThrow(
        'Set --broker-url or COMPARTMENT_MANAGED_DOMAIN_BROKER_URL.',
      );
    }
    for (const envBrokerUrl of ['', '   ']) {
      expect((): string =>
        resolveInstallManagedDomainBrokerUrl(undefined, {
          COMPARTMENT_MANAGED_DOMAIN_BROKER_URL: envBrokerUrl,
        }),
      ).toThrow('Set --broker-url or COMPARTMENT_MANAGED_DOMAIN_BROKER_URL.');
    }
  });
});

function managedDeploymentInput(brokerUrl: string): KubernetesInstallDeploymentInput {
  return {
    acmeEmail: 'admin@example.com',
    brokerUrl,
    clearConfiguredIngressEndpoint: false,
    configuredIngressEndpoint: null,
    domainMode: 'managed',
    ingressClassName: 'traefik',
    namespace: 'compartment',
    registryHostname: 'registry.acme.compartment.run',
    registryIssuerRef: { group: 'cert-manager.io', kind: 'Issuer', name: 'compartment-platform' },
    releaseName: 'compartment',
    valuesPath: '/tmp/values.yaml',
  };
}
