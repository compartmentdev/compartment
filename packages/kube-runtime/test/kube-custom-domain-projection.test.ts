import { describe, expect, it } from 'vitest';
import {
  observeCustomDomainProjection,
  projectCustomDomainManifests,
  type CustomDomainProjectionRow,
  type KubeManifest,
  type KubeObservedManifest,
} from '../src';

const row: CustomDomainProjectionRow = {
  caddyServiceName: 'compartment-caddy',
  domainId: 'cdom_immutable',
  host: 'app.customer.example.com',
  ingressClassName: 'traefik',
  issuerRef: { kind: 'Issuer', name: 'compartment-platform' },
  namespace: 'compartment',
};

describe('custom domain Kubernetes projection', (): void => {
  it('projects one exact-host Ingress through Caddy and never a project Service', (): void => {
    const [ingress]: KubeManifest[] = projectCustomDomainManifests(row);

    expect(ingress).toMatchObject({
      kind: 'Ingress',
      metadata: { namespace: 'compartment' },
      spec: {
        ingressClassName: 'traefik',
        rules: [
          {
            host: 'app.customer.example.com',
            http: {
              paths: [{ backend: { service: { name: 'compartment-caddy', port: { name: 'http' } } } }],
            },
          },
        ],
        tls: [{ hosts: ['app.customer.example.com'] }],
      },
    });
    expect(ingress?.metadata?.name).toContain('cdom-immutable');
    expect(JSON.stringify(ingress)).not.toContain('project-service');
    expect(JSON.stringify(ingress)).not.toContain('*');
  });

  it('projects one exact-host Certificate through the retained issuerRef', (): void => {
    const [, certificate]: KubeManifest[] = projectCustomDomainManifests(row);

    expect(certificate).toMatchObject({
      kind: 'Certificate',
      metadata: { namespace: 'compartment' },
      spec: {
        dnsNames: ['app.customer.example.com'],
        issuerRef: { kind: 'Issuer', name: 'compartment-platform' },
      },
    });
    expect(certificate?.metadata?.name).toContain('cdom-immutable');
  });

  it('rejects stale Certificate readiness and a non-Caddy Ingress projection', (): void => {
    const manifests: KubeManifest[] = projectCustomDomainManifests(row);
    const [ingress, certificate]: KubeManifest[] = manifests;
    if (ingress === undefined || certificate === undefined) {
      throw new Error('Expected custom domain projections.');
    }
    const readyCertificate: KubeManifest = {
      ...certificate,
      metadata: { ...certificate.metadata, generation: 3 },
      status: { conditions: [{ status: 'True', type: 'Ready' }], observedGeneration: 3 },
    };
    const bypassIngress: KubeObservedManifest = {
      apiVersion: 'networking.k8s.io/v1',
      kind: 'Ingress',
      metadata: { ...ingress.metadata },
      spec: { backendServiceName: 'project-service' },
    };

    expect(observeCustomDomainProjection(manifests, ingress, readyCertificate)).toEqual({
      certificatePresent: true,
      certificateReady: true,
      ingressPresent: true,
    });
    expect(
      observeCustomDomainProjection(manifests, ingress, {
        ...readyCertificate,
        status: { conditions: [{ status: 'True', type: 'Ready' }], observedGeneration: 2 },
      }),
    ).toMatchObject({ certificateReady: false });
    expect(observeCustomDomainProjection(manifests, bypassIngress, readyCertificate)).toMatchObject({
      ingressPresent: false,
    });
  });
});
