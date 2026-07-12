import { describe, expect, it } from 'vitest';
import { stringify } from 'yaml';
import {
  kubeApplicationName,
  kubeSecretName,
  projectApplicationManifests,
  projectSecretManifest,
  type ApplicationProjectionRow,
  type ApplicationProjectionOptions,
  type KubeManifest,
} from '../src';
import type { KubeSecretEnvVariable } from '../src/kube-runtime.types';

interface DeploymentSpec {
  template: {
    metadata: { annotations: Record<string, string> };
    spec: { automountServiceAccountToken: false; containers: DeploymentContainer[] };
  };
}

interface DeploymentContainer {
  env: KubeSecretEnvVariable[];
}

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
        secretId: 'sec-01jz',
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

  it('keeps every variable in one sorted Secret and exposes only secretKeyRef in the pod', (): void => {
    const row: ApplicationProjectionRow = applicationRow({
      GENERATED_PLAIN: 'value-17',
      GENERATED_SENSITIVE: 'value-29',
    });
    const manifests: KubeManifest[] = projectApplicationManifests(row, applicationOptions());
    const secret: KubeManifest = manifests.find((manifest: KubeManifest): boolean => manifest.kind === 'Secret')!;
    const deployment: KubeManifest = manifests.find(
      (manifest: KubeManifest): boolean => manifest.kind === 'Deployment',
    )!;
    const spec: DeploymentSpec = deployment.spec as DeploymentSpec;

    expect(Object.keys(secret.stringData ?? {})).toEqual(['GENERATED_PLAIN', 'GENERATED_SENSITIVE']);
    expect(spec.template.spec.automountServiceAccountToken).toBe(false);
    expect(
      spec.template.spec.containers.flatMap((container: DeploymentContainer): KubeSecretEnvVariable[] => container.env),
    ).toEqual([
      {
        name: 'GENERATED_PLAIN',
        valueFrom: { secretKeyRef: { key: 'GENERATED_PLAIN', name: kubeSecretName('sec-01jz') } },
      },
      {
        name: 'GENERATED_SENSITIVE',
        valueFrom: { secretKeyRef: { key: 'GENERATED_SENSITIVE', name: kubeSecretName('sec-01jz') } },
      },
    ]);
    expect(JSON.stringify(spec.template.spec)).not.toContain('"value"');
    expect(spec.template.metadata.annotations['compartment.dev/secret-checksum']).toBe(
      secret.metadata?.annotations?.['compartment.dev/checksum'],
    );
  });

  it('changes the pod checksum only when Secret data changes', (): void => {
    const first: KubeManifest = deploymentFor({ ALPHA: 'one', ZETA: 'two' });
    const reordered: KubeManifest = deploymentFor({ ZETA: 'two', ALPHA: 'one' });
    const changed: KubeManifest = deploymentFor({ ALPHA: 'changed', ZETA: 'two' });
    const metadataChanged: KubeManifest = projectApplicationManifests(
      {
        ...applicationRow({ ALPHA: 'one', ZETA: 'two' }),
        image: 'registry.example/other@sha256:generated',
        replicas: 3,
      },
      applicationOptions(),
    ).find((manifest: KubeManifest): boolean => manifest.kind === 'Deployment')!;
    const checksum: (manifest: KubeManifest) => string | undefined = (manifest: KubeManifest): string | undefined =>
      (manifest.spec as DeploymentSpec).template.metadata.annotations['compartment.dev/secret-checksum'];
    expect(checksum(first)).toBe(checksum(reordered));
    expect(checksum(first)).toBe(checksum(metadataChanged));
    expect(checksum(first)).not.toBe(checksum(changed));
  });

  it('makes plaintext projected env values unrepresentable', (): void => {
    // @ts-expect-error Plaintext Deployment env is forbidden by the root manifest union.
    const invalid: KubeManifest = {
      apiVersion: 'apps/v1',
      kind: 'Deployment',
      metadata: { name: 'invalid' },
      spec: {
        progressDeadlineSeconds: 1,
        replicas: 1,
        selector: {},
        strategy: {},
        template: {
          metadata: { labels: {} },
          spec: {
            automountServiceAccountToken: false,
            containers: [{ env: [{ name: 'GENERATED', value: 'not-a-real-secret' }], image: 'generated', name: 'app' }],
          },
        },
      },
    };
    expect(invalid).toBeDefined();
  });

  it('keeps long immutable IDs unique inside DNS-1123 length', (): void => {
    const first: string = kubeApplicationName(`dep-${'a'.repeat(80)}`);
    const second: string = kubeApplicationName(`dep-${'a'.repeat(79)}b`);
    expect(first).toHaveLength(63);
    expect(second).toHaveLength(63);
    expect(first).not.toBe(second);
  });
});

function deploymentFor(env: Readonly<Record<string, string>>): KubeManifest {
  return projectApplicationManifests(applicationRow(env), applicationOptions()).find(
    (manifest: KubeManifest): boolean => manifest.kind === 'Deployment',
  )!;
}

function applicationRow(env: Readonly<Record<string, string>>): ApplicationProjectionRow {
  return {
    containerPort: 8080,
    deploymentId: 'dep-01jz',
    environmentId: 'env-01jz',
    environmentName: 'Production',
    env,
    image: 'registry.example/app@sha256:generated',
    namespaceId: 'prj-01jz',
    organizationId: 'org-01jz',
    organizationName: 'Generated',
    projectId: 'prj-01jz',
    projectName: 'Generated',
    replicas: 1,
    secretId: 'sec-01jz',
    serviceId: 'svc-01jz',
    serviceName: 'Web',
  };
}

function applicationOptions(): ApplicationProjectionOptions {
  return {
    ingressNamespaceId: 'platform-01jz',
    ingressPodLabels: { app: 'ingress' },
    podCidr: ['10', '42', '0', '0/16'].join('.'),
    serviceCidr: ['10', '43', '0', '0/16'].join('.'),
  };
}

function toYaml(manifests: KubeManifest[]): string {
  return manifests
    .map((manifest: KubeManifest): string => stringify(manifest, { sortMapEntries: true }).trim())
    .join('\n---\n');
}
