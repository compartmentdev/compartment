import { describe, expect, it } from 'vitest';
import type { SafeParseReturnType } from 'zod';

import {
  createOrganizationRequestSchema,
  createOrganizationResponseSchema,
  installRequestSchema,
  installResponseSchema,
  projectLifecycleRequestSchema,
  projectLifecycleResponseSchema,
  type CreateOrganizationRequest,
  type CreateOrganizationResponse,
  type DeploymentSummary,
  type InstallRequest,
  type InstallResponse,
  type ProjectLifecycleRequest,
  type ProjectLifecycleResponse,
  type SystemDomainAttachCertificateRequest,
  type SystemDomainMutationResponse,
  type SystemDomainSetRequest,
  type SystemDomainStatusResponse,
  type SystemDomainVersionedRequest,
  systemDomainAttachCertificateRequestSchema,
  systemDomainMutationResponseSchema,
  systemDomainSetRequestSchema,
  systemDomainStatusResponseSchema,
  systemDomainVersionedRequestSchema,
} from '../src';

describe('contract schemas system and domain', (): void => {
  it('accepts a valid install response', (): void => {
    const result: InstallResponse = installResponseSchema.parse({
      adminEmail: 'admin@example.com',
      baseDomain: 'example.com',
      dnsRecords: [
        {
          host: '*.example.com',
          purpose: 'Compartment control plane and hosted application entrypoints',
          type: 'A/AAAA-or-CNAME',
        },
      ],
      operation: {
        completedAt: null,
        createdAt: '2026-03-21T10:00:00.000Z',
        id: 'op_123',
        status: 'succeeded',
        targetId: 'org_123',
        targetType: 'organization',
        type: 'compartment.install',
      },
      organization: {
        id: 'org_123',
        name: 'Acme Dev',
        slug: 'acme-dev',
      },
      compartmentUrl: 'https://console.example.com',
      sessionToken: 'session_123',
    });

    expect(result.sessionToken).toBe('session_123');
  });

  it('accepts a valid create organization request', (): void => {
    const result: CreateOrganizationRequest = createOrganizationRequestSchema.parse({
      name: 'Beta Dev',
      slug: 'beta-dev',
    });

    expect(result.slug).toBe('beta-dev');
  });

  it('accepts project lifecycle payloads', (): void => {
    const request: ProjectLifecycleRequest = projectLifecycleRequestSchema.parse({
      environmentName: 'production',
    });
    const defaultRequest: ProjectLifecycleRequest = projectLifecycleRequestSchema.parse(undefined);
    const response: ProjectLifecycleResponse = projectLifecycleResponseSchema.parse({
      action: 'start',
      deployments: [createDeploymentSummary({ promotionStage: 'stopped', status: 'stopped' })],
      environment: {
        createdAt: '2026-03-21T10:00:00.000Z',
        id: 'env_123',
        name: 'production',
        projectId: 'prj_123',
        updatedAt: '2026-03-21T10:00:00.000Z',
      },
      project: {
        archivedAt: null,
        createdAt: '2026-03-21T10:00:00.000Z',
        id: 'prj_123',
        name: 'billing',
        organizationId: 'org_123',
        updatedAt: '2026-03-21T10:00:00.000Z',
      },
      state: 'updating',
    });

    expect(request.environmentName).toBe('production');
    expect(defaultRequest.environmentName).toBeUndefined();
    expect(response.deployments[0]!.status).toBe('stopped');
  });

  it('accepts a valid system domain status response', (): void => {
    const result: SystemDomainStatusResponse = systemDomainStatusResponseSchema.parse({
      active: {
        baseDomain: 'customer.example.com',
        domainKind: 'custom',
        publicScheme: 'http',
        tlsMode: 'external',
      },
      activeDomainHealth: {
        checkedAt: null,
        failureCode: null,
        failureMessage: null,
        status: 'unknown',
      },
      setupVersion: 1,
      pending: {
        certificate: null,
        failureCode: null,
        failureMessage: null,
        hostPlan: {
          baseDomain: 'next.example.com',
          domainKind: 'custom',
          publicScheme: 'https',
          tlsMode: 'external',
        },
        operationId: 'domop_123',
        requiredDnsRecords: [
          {
            groupId: 'ownership',
            name: '_compartment-domain.next.example.com',
            purpose: 'ownership',
            recordType: 'TXT',
            required: true,
            value: 'compartment-domain-verification=domop_123',
          },
          {
            groupId: 'routing',
            name: 'console.next.example.com',
            purpose: 'routing',
            recordType: 'A',
            required: true,
            value: '203.0.113.10',
          },
        ],
        status: 'pending_dns',
      },
    });

    expect(result.pending?.requiredDnsRecords[0]?.recordType).toBe('TXT');
  });

  it('accepts a valid system domain set request', (): void => {
    const result: SystemDomainSetRequest = systemDomainSetRequestSchema.parse({
      expectedSetupVersion: 1,
      hostPlan: {
        baseDomain: 'customer.example.com',
        domainKind: 'custom',
        publicScheme: 'http',
        tlsMode: 'external',
      },
    });

    expect(result.expectedSetupVersion).toBe(1);
  });

  it('accepts a valid system domain attach certificate request', (): void => {
    const result: SystemDomainAttachCertificateRequest = systemDomainAttachCertificateRequestSchema.parse({
      certificate: {
        metadata: {
          dnsNames: ['console.customer.example.com', '*.customer.example.com'],
          expiresAt: '2026-07-01T00:00:00.000Z',
          fingerprintSha256: 'AA:BB:CC',
          issuedAt: '2026-04-01T00:00:00.000Z',
          issuer: 'CN=Example CA',
          serialNumber: '01',
          subject: 'CN=console.customer.example.com',
        },
        secretName: 'domain-tls-operation',
      },
      expectedSetupVersion: 1,
    });

    expect(result.expectedSetupVersion).toBe(1);
  });

  it('rejects legacy certificate fields on the system domain attach certificate request', (): void => {
    expect(
      (): SystemDomainAttachCertificateRequest =>
        systemDomainAttachCertificateRequestSchema.parse({
          certificate: {
            certificatePath: '/etc/compartment/tls/domop_123/fullchain.pem',
            metadata: {
              dnsNames: ['console.customer.example.com', '*.customer.example.com'],
              expiresAt: '2026-07-01T00:00:00.000Z',
              fingerprintSha256: 'AA:BB:CC',
              issuedAt: '2026-04-01T00:00:00.000Z',
              issuer: 'CN=Example CA',
              serialNumber: '01',
              subject: 'CN=console.customer.example.com',
            },
            privateKeyPath: '/etc/compartment/tls/domop_123/privkey.pem',
          },
          expectedSetupVersion: 1,
        }),
    ).toThrow();
  });

  it('accepts a valid system domain versioned request', (): void => {
    const result: SystemDomainVersionedRequest = systemDomainVersionedRequestSchema.parse({
      expectedSetupVersion: 2,
    });

    expect(result.expectedSetupVersion).toBe(2);
  });

  it('accepts a valid system domain mutation response', (): void => {
    const result: SystemDomainMutationResponse = systemDomainMutationResponseSchema.parse({
      setupVersion: 2,
      operationId: 'domain_op_123',
      status: {
        active: {
          baseDomain: 'localhost',
          domainKind: 'local',
          publicScheme: 'http',
          tlsMode: 'internal',
        },
        activeDomainHealth: {
          checkedAt: null,
          failureCode: null,
          failureMessage: null,
          status: 'unknown',
        },
        setupVersion: 2,
        pending: null,
      },
    });

    expect(result.status.setupVersion).toBe(2);
  });

  it('rejects an install request with an invalid explicit organization slug', (): void => {
    const result: SafeParseReturnType<InstallRequest, InstallRequest> = installRequestSchema.safeParse({
      adminEmail: 'admin@example.com',
      adminPassword: 'supersecretpassword',
      baseDomain: 'example.com',
      organizationName: 'Acme Dev',
      organizationSlug: 'Hello World',
    });

    expect(result.success).toBe(false);
  });

  it('rejects a create organization request with an invalid explicit slug', (): void => {
    const result: SafeParseReturnType<CreateOrganizationRequest, CreateOrganizationRequest> =
      createOrganizationRequestSchema.safeParse({
        name: 'Beta Dev',
        slug: '!!!abc',
      });

    expect(result.success).toBe(false);
  });

  it('accepts a valid create organization response', (): void => {
    const result: CreateOrganizationResponse = createOrganizationResponseSchema.parse({
      operation: {
        completedAt: null,
        createdAt: '2026-03-21T10:00:00.000Z',
        id: 'op_456',
        status: 'succeeded',
        targetId: 'org_456',
        targetType: 'organization',
        type: 'organization.create',
      },
      organization: {
        id: 'org_456',
        name: 'Beta Dev',
        slug: 'beta-dev',
      },
    });

    expect(result.organization.slug).toBe('beta-dev');
  });

  it('rejects organization response payloads with non-canonical slugs', (): void => {
    const result: SafeParseReturnType<CreateOrganizationResponse, CreateOrganizationResponse> =
      createOrganizationResponseSchema.safeParse({
        operation: {
          completedAt: null,
          createdAt: '2026-03-21T10:00:00.000Z',
          id: 'op_789',
          status: 'succeeded',
          targetId: 'org_789',
          targetType: 'organization',
          type: 'organization.create',
        },
        organization: {
          id: 'org_789',
          name: 'Legacy Org',
          slug: 'Legacy_Org',
        },
      });

    expect(result.success).toBe(false);
  });
});

function createDeploymentSummary(overrides?: Partial<DeploymentSummary>): DeploymentSummary {
  return {
    build: {
      env: [],
      include: [],
      packages: {
        build: [],
        runtime: [],
      },
      strategy: 'auto',
    },
    completedAt: '2026-03-21T10:00:00.000Z',
    createdAt: '2026-03-21T09:00:00.000Z',
    failureMessage: null,
    health: 'healthy',
    id: 'dep_123',
    isActive: true,
    label: null,
    operation: {
      completedAt: '2026-03-21T10:00:00.000Z',
      createdAt: '2026-03-21T09:00:00.000Z',
      id: 'op_123',
      status: 'succeeded',
      targetId: 'dep_123',
      targetType: 'deployment',
      type: 'deployment.create',
    },
    promotionStage: 'active',
    readiness: {
      path: '/ready',
      timeoutMs: 30000,
      type: 'http',
    },
    rollbackAvailable: false,
    routeUrl: 'https://billing.apps.localhost',
    run: {},
    serviceName: 'web',
    status: 'succeeded',
    ...overrides,
  };
}
