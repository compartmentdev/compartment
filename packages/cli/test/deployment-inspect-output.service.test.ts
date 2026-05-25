import { describe, expect, it } from 'vitest';
import type { DeploymentInspectResponse, DeploymentInspectTarget } from '@compartment/contracts';
import { createInspectResultMessage } from '../src/services/deployment-inspect-output.service';

describe('deployment inspect output service', (): void => {
  it('shows n/a for route host when the deployment has no live route row', (): void => {
    const message: string = createInspectResultMessage(createInspectResponse(), true);

    expect(message).toContain('Route Host: n/a');
    expect(message).toContain('Upstream Host: n/a');
    expect(message).not.toContain('Route Host: smoke-web.localhost');
  });

  it('shows resolved build and runtime packages in verbose inspect output', (): void => {
    const message: string = createInspectResultMessage(
      createInspectResponse({
        buildPackages: ['build-essential'],
        label: 'release 42',
        runtimePackages: ['libnss3', 'libxss1'],
      }),
      true,
    );

    expect(message).toContain('Label: release 42');
    expect(message).toContain('Build Packages: build-essential');
    expect(message).toContain('Runtime Packages: libnss3, libxss1');
    expect(message).toContain('Restart Policy: on-failure');
  });

  it('shows redacted topology when inspect hides sensitive runtime details', (): void => {
    const message: string = createInspectResultMessage(
      createInspectResponse({
        label: 'release 42',
        routeHost: 'smoke-web.localhost',
        sensitiveTopologyVisible: false,
        upstreamHost: '127.0.0.1',
        upstreamPort: 31000,
      }),
      true,
    );

    expect(message).toContain('Route Host: smoke-web.localhost');
    expect(message).toContain('Upstream Host: redacted');
    expect(message).toContain('Upstream Port: redacted');
    expect(message).toContain('Label: release 42');
  });

  it('shows labels in aggregate inspect summaries', (): void => {
    const message: string = createInspectResultMessage(
      createAggregateInspectResponse({
        backofficeLabel: 'release=42;hotfix',
        webLabel: 'candidate',
      }),
      false,
    );

    expect(message).toBe(
      'Inspect smoke-web/production: web [label="candidate"]=succeeded (active); backoffice [label="release=42;hotfix"]=succeeded (active).',
    );
  });

  it('summarizes aggregate inspect output for multiple services', (): void => {
    const message: string = createInspectResultMessage(createAggregateInspectResponse(), false);

    expect(message).toBe('Inspect smoke-web/production: web=succeeded (active); backoffice=succeeded (active).');
  });
});

interface CreateAggregateInspectResponseInput {
  backofficeLabel?: string | null | undefined;
  webLabel?: string | null | undefined;
}

interface CreateInspectResponseInput {
  buildPackages?: string[] | undefined;
  label?: string | null | undefined;
  routeHost?: string | null | undefined;
  runtimePackages?: string[] | undefined;
  sensitiveTopologyVisible?: boolean | undefined;
  upstreamHost?: string | null | undefined;
  upstreamPort?: number | null | undefined;
}

function createInspectResponse(input: CreateInspectResponseInput = {}): DeploymentInspectResponse {
  const deployment: DeploymentInspectTarget = {
    build: {
      env: [],
      include: [],
      packages: {
        build: input.buildPackages ?? [],
        runtime: input.runtimePackages ?? [],
      },
      strategy: 'auto',
    },
    completedAt: '2026-03-24T10:00:00.000Z',
    containerId: 'container_123',
    createdAt: '2026-03-24T09:00:00.000Z',
    drain: null,
    failureMessage: null,
    health: 'healthy',
    id: 'dep_123',
    isActive: false,
    label: input.label ?? null,
    operation: {
      completedAt: '2026-03-24T10:00:00.000Z',
      createdAt: '2026-03-24T09:00:00.000Z',
      id: 'op_123',
      status: 'succeeded',
      targetId: 'dep_123',
      targetType: 'deployment',
      type: 'deployment.create',
    },
    promotionStage: 'rolled_back',
    readiness: {
      path: '/healthz',
      timeoutMs: 30000,
      type: 'http',
    },
    rollbackAvailable: false,
    run: {
      restart: {
        policy: 'on-failure',
      },
    },
    routes: [],
    routeHost: input.routeHost ?? null,
    upstreamHost: input.upstreamHost ?? null,
    upstreamPort: input.upstreamPort ?? null,
    routeUrl: null,
    runtime: null,
    serviceName: 'web',
    status: 'succeeded',
  };

  return {
    activeDeployments: [],
    deployments: [deployment],
    environment: {
      createdAt: '2026-03-24T09:00:00.000Z',
      id: 'env_123',
      name: 'production',
      projectId: 'prj_123',
      updatedAt: '2026-03-24T09:00:00.000Z',
    },
    project: {
      archivedAt: null,
      createdAt: '2026-03-24T09:00:00.000Z',
      id: 'prj_123',
      name: 'smoke-web',
      organizationId: 'org_123',
      updatedAt: '2026-03-24T09:00:00.000Z',
    },
    sensitiveTopologyVisible: input.sensitiveTopologyVisible ?? true,
  };
}

function createAggregateInspectResponse(input: CreateAggregateInspectResponseInput = {}): DeploymentInspectResponse {
  const webDeployment: DeploymentInspectTarget = {
    ...createInspectResponse().deployments[0]!,
    isActive: true,
    label: input.webLabel ?? null,
    promotionStage: 'active',
    routeHost: 'smoke-web.localhost',
    routeUrl: 'http://smoke-web.localhost',
  };
  const backofficeDeployment: DeploymentInspectTarget = {
    ...webDeployment,
    id: 'dep_456',
    label: input.backofficeLabel ?? null,
    operation: {
      ...webDeployment.operation,
      id: 'op_456',
      targetId: 'dep_456',
    },
    routeHost: 'backoffice-smoke-web.localhost',
    routeUrl: 'http://backoffice-smoke-web.localhost',
    serviceName: 'backoffice',
  };

  return {
    activeDeployments: [webDeployment, backofficeDeployment],
    deployments: [webDeployment, backofficeDeployment],
    environment: {
      createdAt: '2026-03-24T09:00:00.000Z',
      id: 'env_123',
      name: 'production',
      projectId: 'prj_123',
      updatedAt: '2026-03-24T09:00:00.000Z',
    },
    project: {
      archivedAt: null,
      createdAt: '2026-03-24T09:00:00.000Z',
      id: 'prj_123',
      name: 'smoke-web',
      organizationId: 'org_123',
      updatedAt: '2026-03-24T09:00:00.000Z',
    },
    sensitiveTopologyVisible: true,
  };
}
