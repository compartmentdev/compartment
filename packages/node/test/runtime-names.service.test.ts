import { describe, expect, it } from 'vitest';
import {
  buildDeploymentReleaseContainerName,
  buildDeploymentUpstreamHost,
  buildRuntimeResourceNetworkName,
  buildRuntimeServiceNetworkName,
  isRuntimeNetworkName,
} from '../src/services/runtime-names.service';

describe('buildDeploymentUpstreamHost', (): void => {
  it('keeps short aliases readable', (): void => {
    expect(
      buildDeploymentUpstreamHost(
        {
          deploymentId: 'dep_123456',
          environmentName: 'production',
          projectName: 'smoke-web',
          serviceName: 'web',
        },
        'compartment-e2e',
      ),
    ).toBe('compartment-compartment-e2e-smoke-web-production-web-dep-123456');
  });

  it('caps long aliases to a dns-safe hostname label', (): void => {
    const upstreamHost: string = buildDeploymentUpstreamHost(
      {
        deploymentId: 'deployment_1234567890abcdef1234567890abcdef1234567890abcdef',
        environmentName: 'production-preview-environment',
        projectName: 'very-long-project-name-for-runtime-connectivity-check',
        serviceName: 'web-service-for-internal-routing',
      },
      'very-long-docker-namespace-for-runtime-connectivity',
    );

    expect(upstreamHost.length).toBeLessThanOrEqual(63);
    expect(upstreamHost).toMatch(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/);
    expect(upstreamHost).toBe(
      buildDeploymentUpstreamHost(
        {
          deploymentId: 'deployment_1234567890abcdef1234567890abcdef1234567890abcdef',
          environmentName: 'production-preview-environment',
          projectName: 'very-long-project-name-for-runtime-connectivity-check',
          serviceName: 'web-service-for-internal-routing',
        },
        'very-long-docker-namespace-for-runtime-connectivity',
      ),
    );
  });

  it('changes the hash when long identities differ', (): void => {
    const firstUpstreamHost: string = buildDeploymentUpstreamHost(
      {
        deploymentId: 'deployment_1234567890abcdef1234567890abcdef1234567890abcdef',
        environmentName: 'production-preview-environment',
        projectName: 'very-long-project-name-for-runtime-connectivity-check',
        serviceName: 'web-service-for-internal-routing',
      },
      'very-long-docker-namespace-for-runtime-connectivity',
    );
    const secondUpstreamHost: string = buildDeploymentUpstreamHost(
      {
        deploymentId: 'deployment_abcdef1234567890abcdef1234567890abcdef1234567890',
        environmentName: 'production-preview-environment',
        projectName: 'very-long-project-name-for-runtime-connectivity-check',
        serviceName: 'web-service-for-internal-routing',
      },
      'very-long-docker-namespace-for-runtime-connectivity',
    );

    expect(firstUpstreamHost).not.toBe(secondUpstreamHost);
  });

  it('derives a stable service-scoped runtime network from stable ids', (): void => {
    expect(
      buildRuntimeServiceNetworkName(
        {
          environmentId: 'env_production',
          projectId: 'prj_smoke_web',
          serviceId: 'svc_web',
        },
        'compartment-e2e',
      ),
    ).toBe('compartment-compartment-e2e-prj-smoke-web-env-prod-a6177f61b48c');
  });

  it('recognizes shortened runtime network names for long docker namespaces', (): void => {
    const dockerNamespace: string = 'runtime-namespace-with-enough-characters-to-force-prefix-hashing';
    const networkName: string = buildRuntimeResourceNetworkName(
      {
        environmentId: 'env_production',
        projectId: 'prj_smoke_web',
      },
      dockerNamespace,
    );

    expect(networkName).toHaveLength(63);
    expect(networkName.startsWith(`compartment-${dockerNamespace}-`)).toBe(false);
    expect(isRuntimeNetworkName(networkName, dockerNamespace)).toBe(true);
    expect(isRuntimeNetworkName(networkName, 'other-runtime-namespace')).toBe(false);
    expect(isRuntimeNetworkName('monitoring-shared-network', dockerNamespace)).toBe(false);
  });
});

describe('buildDeploymentReleaseContainerName', (): void => {
  it('keeps short release container names readable', (): void => {
    expect(
      buildDeploymentReleaseContainerName(
        {
          deploymentId: 'dep_123456',
          environmentName: 'production',
          projectName: 'smoke-web',
          serviceName: 'web',
        },
        'compartment-e2e',
      ),
    ).toBe('compartment-compartment-e2e-smoke-web-production-web-dep_123456-release');
  });

  it('caps long release container names with a deterministic hash suffix', (): void => {
    const releaseContainerName: string = buildDeploymentReleaseContainerName(
      {
        deploymentId: 'deployment_1234567890abcdef1234567890abcdef1234567890abcdef',
        environmentName: 'production-preview-environment-with-long-name',
        projectName: 'very-long-project-name-for-runtime-container-name-check',
        serviceName: 'web-service-for-release-container-name-check',
      },
      'very-long-docker-namespace-for-release-container-name-check',
    );

    expect(releaseContainerName.length).toBeLessThanOrEqual(255);
    expect(releaseContainerName).toMatch(/^[a-z0-9][a-z0-9_.-]*[a-z0-9]$/);
    expect(releaseContainerName).toBe(
      buildDeploymentReleaseContainerName(
        {
          deploymentId: 'deployment_1234567890abcdef1234567890abcdef1234567890abcdef',
          environmentName: 'production-preview-environment-with-long-name',
          projectName: 'very-long-project-name-for-runtime-container-name-check',
          serviceName: 'web-service-for-release-container-name-check',
        },
        'very-long-docker-namespace-for-release-container-name-check',
      ),
    );
  });

  it('changes the hash when long release container identities differ', (): void => {
    const firstReleaseContainerName: string = buildDeploymentReleaseContainerName(
      {
        deploymentId: 'deployment_1234567890abcdef1234567890abcdef1234567890abcdef',
        environmentName: 'production-preview-environment-with-long-name',
        projectName: 'very-long-project-name-for-runtime-container-name-check',
        serviceName: 'web-service-for-release-container-name-check',
      },
      'very-long-docker-namespace-for-release-container-name-check',
    );
    const secondReleaseContainerName: string = buildDeploymentReleaseContainerName(
      {
        deploymentId: 'deployment_abcdef1234567890abcdef1234567890abcdef1234567890',
        environmentName: 'production-preview-environment-with-long-name',
        projectName: 'very-long-project-name-for-runtime-container-name-check',
        serviceName: 'web-service-for-release-container-name-check',
      },
      'very-long-docker-namespace-for-release-container-name-check',
    );

    expect(firstReleaseContainerName).not.toBe(secondReleaseContainerName);
  });
});
