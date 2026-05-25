import { describe, expect, it } from 'vitest';
import {
  buildCanonicalRouteHost,
  buildInstallationHostPlan,
  buildPublicRouteUrl,
  buildRuntimePublicSettings,
} from '../src/services/public-hosts.service';
import type { PublicIngressPortConfig, RuntimePublicSettingsConfig } from '../src/services/public-hosts.service.types';

const dnsLabelPattern: RegExp = /^[a-z0-9-]+$/u;
const defaultPublicIngressPorts: PublicIngressPortConfig = {
  publicProtocol: 'https',
  publicHttpPort: 80,
  publicHttpsPort: 443,
};

describe('public hosts service', (): void => {
  it('normalizes non-production environment names into valid DNS labels', (): void => {
    expect(
      buildCanonicalRouteHost({
        baseDomain: 'example.com',
        environmentName: 'QA',
        existingHosts: [],
        includeServiceLabel: false,
        organizationId: 'org_alpha',
        projectName: 'Billing',
        serviceName: 'web',
      }),
    ).toBe('billing-qa.example.com');

    expect(
      buildCanonicalRouteHost({
        baseDomain: 'example.com',
        environmentName: 'staging_us',
        existingHosts: [],
        includeServiceLabel: false,
        organizationId: 'org_alpha',
        projectName: 'Billing',
        serviceName: 'web',
      }),
    ).toBe('billing-staging-us.example.com');

    expect(
      buildCanonicalRouteHost({
        baseDomain: 'example.com',
        environmentName: 'my env',
        existingHosts: [],
        includeServiceLabel: true,
        organizationId: 'org_alpha',
        projectName: 'Billing',
        serviceName: 'Public API',
      }),
    ).toBe('public-api-billing-my-env.example.com');
  });

  it('uses organization identity in the collision suffix', (): void => {
    const alphaHost: string = buildCanonicalRouteHost({
      baseDomain: 'example.com',
      environmentName: 'production',
      existingHosts: ['billing.example.com'],
      includeServiceLabel: false,
      organizationId: 'org_alpha',
      projectName: 'Billing',
      serviceName: 'web',
    });
    const betaHost: string = buildCanonicalRouteHost({
      baseDomain: 'example.com',
      environmentName: 'production',
      existingHosts: ['billing.example.com'],
      includeServiceLabel: false,
      organizationId: 'org_beta',
      projectName: 'Billing',
      serviceName: 'web',
    });

    expect(alphaHost).not.toBe(betaHost);
  });

  it('keeps searching when the first collision-suffixed host is already taken', (): void => {
    const firstCollisionHost: string = buildCanonicalRouteHost({
      baseDomain: 'example.com',
      environmentName: 'production',
      existingHosts: ['billing.example.com'],
      includeServiceLabel: false,
      organizationId: 'org_alpha',
      projectName: 'Billing',
      serviceName: 'web',
    });
    const secondCollisionHost: string = buildCanonicalRouteHost({
      baseDomain: 'example.com',
      environmentName: 'production',
      existingHosts: ['billing.example.com', firstCollisionHost],
      includeServiceLabel: false,
      organizationId: 'org_alpha',
      projectName: 'Billing',
      serviceName: 'web',
    });

    expect(secondCollisionHost).not.toBe('billing.example.com');
    expect(secondCollisionHost).not.toBe(firstCollisionHost);
    expect(secondCollisionHost.endsWith('.example.com')).toBe(true);
  });

  it('uses DNS-safe suffixes for collision and truncation hosts', (): void => {
    const collisionHost: string = buildCanonicalRouteHost({
      baseDomain: 'example.com',
      environmentName: 'production',
      existingHosts: ['billing.example.com'],
      includeServiceLabel: false,
      organizationId: 'org_alpha',
      projectName: 'Billing',
      serviceName: 'web',
    });
    const truncatedHost: string = buildCanonicalRouteHost({
      baseDomain: 'example.com',
      environmentName: 'production',
      existingHosts: [],
      includeServiceLabel: false,
      organizationId: 'org_alpha',
      projectName:
        'This project name is intentionally much longer than sixty three characters so truncation is required',
      serviceName: 'web',
    });

    expect(collisionHost).toMatch(/^billing-[a-f0-9]{6}\.example\.com$/u);
    expect(readAppHostLabels(truncatedHost).every(isDnsSafeLabel)).toBe(true);
  });

  it('keeps the primary web service unprefixed and prefixes secondary services', (): void => {
    const webHost: string = buildCanonicalRouteHost({
      baseDomain: 'example.com',
      environmentName: 'production',
      existingHosts: [],
      includeServiceLabel: false,
      organizationId: 'org_alpha',
      projectName: 'Billing',
      serviceName: 'web',
    });
    const apiHost: string = buildCanonicalRouteHost({
      baseDomain: 'example.com',
      environmentName: 'production',
      existingHosts: [webHost],
      includeServiceLabel: true,
      organizationId: 'org_alpha',
      projectName: 'Billing',
      serviceName: 'api',
    });

    expect(webHost).toBe('billing.example.com');
    expect(apiHost).toBe('api-billing.example.com');
  });

  it('does not allocate the reserved control-plane label to an app route', (): void => {
    expect(
      buildCanonicalRouteHost({
        baseDomain: 'example.com',
        environmentName: 'production',
        existingHosts: [],
        includeServiceLabel: false,
        organizationId: 'org_alpha',
        projectName: 'console',
        serviceName: 'web',
      }),
    ).toBe('app.example.com');
  });

  it('includes configured public ports in compartment and route URLs', (): void => {
    const customPublicIngressPorts: PublicIngressPortConfig = {
      publicProtocol: 'http',
      publicHttpPort: 38080,
      publicHttpsPort: 38443,
    };

    expect(buildInstallationHostPlan('localhost', customPublicIngressPorts).compartmentUrl).toBe(
      'http://console.localhost:38080',
    );
    expect(
      buildPublicRouteUrl(
        {
          host: 'billing.localhost',
        },
        customPublicIngressPorts,
      ),
    ).toBe('http://billing.localhost:38080');
    expect(
      buildPublicRouteUrl(
        {
          host: 'billing.example.com',
        },
        {
          publicProtocol: 'https',
          publicHttpPort: 38080,
          publicHttpsPort: 38443,
        },
      ),
    ).toBe('https://billing.example.com:38443');
    expect(
      buildPublicRouteUrl(
        {
          host: 'billing.example.com',
        },
        defaultPublicIngressPorts,
      ),
    ).toBe('https://billing.example.com');
  });

  it('derives the control-plane host from baseDomain when rendering installation public URLs', (): void => {
    const config: RuntimePublicSettingsConfig = {
      ...defaultPublicIngressPorts,
      baseDomain: 'apps.example.com',
    };

    expect(buildRuntimePublicSettings(config).compartmentUrl).toBe('https://console.apps.example.com');
  });
});

function readAppHostLabels(host: string): string[] {
  return host.replace(/\.example\.com$/u, '').split('.');
}

function isDnsSafeLabel(label: string): boolean {
  return dnsLabelPattern.test(label);
}
