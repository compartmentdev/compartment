import { describe, expect, it } from 'vitest';
import { stringify } from 'yaml';
import { kubeApplicationName, projectApplicationManifests, projectSecretManifest, type KubeManifest } from '../src';

describe('Kubernetes manifest projection goldens', (): void => {
  it('projects an application row to the T1 and T2 workload bundle', (): void => {
    const manifests: KubeManifest[] = projectApplicationManifests(
      {
        containerPort: 8080,
        deploymentId: 'dep-01jz',
        environmentId: 'env-01jz',
        environmentName: 'Production',
        env: { LOG_LEVEL: 'info', FEATURE_FLAG: 'enabled' },
        image: 'registry.example/app@sha256:abc',
        namespaceId: 'prj-01jz',
        organizationId: 'org-01jz',
        organizationName: 'Acme',
        projectId: 'prj-01jz',
        projectName: 'Checkout',
        replicas: 2,
        serviceId: 'svc-01jz',
        serviceName: 'Web',
      },
      {
        ingressNamespaceId: 'platform-01jz',
        ingressPodLabels: { 'app.kubernetes.io/name': 'caddy' },
        podCidr: ['10', '42', '0', '0/16'].join('.'),
        serviceCidr: ['10', '43', '0', '0/16'].join('.'),
      },
    );

    expect(toYaml(manifests)).toMatchSnapshot();
  });

  it('projects a secret row without a service-account token', (): void => {
    expect(
      toYaml([
        projectSecretManifest({
          data: { DATABASE_URL: 'postgres://db/app', TOKEN: 'secret' },
          deploymentId: 'dep-01jz',
          namespaceId: 'prj-01jz',
          secretId: 'sec-01jz',
        }),
      ]),
    ).toMatchSnapshot();
  });

  it('keeps long immutable IDs unique inside DNS-1123 length', (): void => {
    const first: string = kubeApplicationName(`dep-${'a'.repeat(80)}`);
    const second: string = kubeApplicationName(`dep-${'a'.repeat(79)}b`);
    expect(first).toHaveLength(63);
    expect(second).toHaveLength(63);
    expect(first).not.toBe(second);
  });
});

function toYaml(manifests: KubeManifest[]): string {
  return manifests
    .map((manifest: KubeManifest): string => stringify(manifest, { sortMapEntries: true }).trim())
    .join('\n---\n');
}
