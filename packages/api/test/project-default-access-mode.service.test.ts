import { buildDefaultCompartmentAuthoredDescriptor, type AppRouteAccessMode } from '@compartment/contracts';
import { describe, expect, it, vi } from 'vitest';
import type { SourceUploadRow } from '../src/queries/source-uploads.query.types';
import { buildPreparedQueuedDeploymentState } from '../src/services/deployment-creation.service.helpers';
import { resolveDescriptorServices } from '../src/services/deployment-context.service.helpers';
import type { ResolvedDescriptorService, ResolvedProjectContext } from '../src/services/deployments.service.types';
import { resolveNewProjectDefaultAccessMode } from '../src/services/project-default-access-mode.service';
import { createApiTestConfig } from './api-config-test.fixtures';

const runtimeConfig = createApiTestConfig();

vi.mock('../src/runtime/runtime-access', () => ({
  getApiConfig: (): typeof runtimeConfig => runtimeConfig,
}));

describe('project default hosted-route access', (): void => {
  it.each([
    [true, 'authenticated'],
    [false, 'public'],
  ] as const)('maps install privacy %s to %s for new projects', (privateByDefault, expected): void => {
    runtimeConfig.newProjectsPrivateByDefault = privateByDefault;
    expect(resolveNewProjectDefaultAccessMode()).toBe(expected);
  });
  it('preserves omitted access mode for shorthand and object services', (): void => {
    const shorthand: ResolvedDescriptorService = resolveDescriptorServices(
      buildDefaultCompartmentAuthoredDescriptor('internal-tools'),
      'web',
    )[0]!;
    const object: ResolvedDescriptorService = resolveDescriptorServices(
      { name: 'internal-tools', services: { web: { path: '.' } } },
      'web',
    )[0]!;

    expect(shorthand.accessMode).toBeUndefined();
    expect(object.accessMode).toBeUndefined();
  });

  it.each<AppRouteAccessMode>(['authenticated', 'public'])(
    'uses the saved %s project default when access mode is omitted',
    (defaultAccessMode: AppRouteAccessMode): void => {
      const descriptorService: ResolvedDescriptorService = resolveDescriptorServices(
        buildDefaultCompartmentAuthoredDescriptor('internal-tools'),
        'web',
      )[0]!;

      expect(
        buildPreparedQueuedDeploymentState(
          'run_123',
          undefined,
          createProjectContext(defaultAccessMode, descriptorService),
          undefined,
          createSourceUpload(),
          {},
        ).accessMode,
      ).toBe(defaultAccessMode);
    },
  );

  it('applies a public project default to object-form service omission', (): void => {
    const descriptorService: ResolvedDescriptorService = resolveDescriptorServices(
      { name: 'internal-tools', services: { web: { path: '.' } } },
      'web',
    )[0]!;

    expect(
      buildPreparedQueuedDeploymentState(
        'run_123',
        undefined,
        createProjectContext('public', descriptorService),
        undefined,
        createSourceUpload(),
        {},
      ).accessMode,
    ).toBe('public');
  });

  it.each([
    ['authenticated', 'public'],
    ['public', 'authenticated'],
  ] as const)(
    'lets explicit %s service access override a %s project default',
    (accessMode: AppRouteAccessMode, defaultAccessMode: AppRouteAccessMode): void => {
      const descriptorService: ResolvedDescriptorService = resolveDescriptorServices(
        { name: 'internal-tools', services: { web: { accessMode, path: '.' } } },
        'web',
      )[0]!;

      expect(
        buildPreparedQueuedDeploymentState(
          'run_123',
          undefined,
          createProjectContext(defaultAccessMode, descriptorService),
          undefined,
          createSourceUpload(),
          {},
        ).accessMode,
      ).toBe(accessMode);
    },
  );
});

function createProjectContext(
  defaultAccessMode: AppRouteAccessMode,
  descriptorService: ResolvedDescriptorService,
): ResolvedProjectContext {
  const now: Date = new Date('2026-08-11T12:00:00.000Z');
  return {
    descriptorService,
    environment: { createdAt: now, id: 'env_123', name: 'production', projectId: 'prj_123', updatedAt: now },
    organization: { id: 'org_123', name: 'Acme', slug: 'acme' },
    project: {
      archivedAt: null,
      createdAt: now,
      defaultAccessMode,
      id: 'prj_123',
      name: 'internal-tools',
      organizationId: 'org_123',
      updatedAt: now,
    },
    service: {
      createdAt: now,
      id: 'svc_123',
      kind: 'web',
      name: 'web',
      path: '.',
      projectId: 'prj_123',
      updatedAt: now,
    },
  };
}

function createSourceUpload(): SourceUploadRow {
  const now: Date = new Date('2026-08-11T12:00:00.000Z');
  return {
    byteSize: 1,
    consumedAt: null,
    createdAt: now,
    createdByPrincipalId: 'prn_123',
    environmentId: null,
    expiresAt: new Date('2026-08-11T13:00:00.000Z'),
    id: 'src_123',
    organizationId: 'org_123',
    projectId: null,
    projectServiceId: null,
    sourceDigest: 'sha256:test',
  };
}
