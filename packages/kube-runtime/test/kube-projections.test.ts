import { describe, expect, it } from 'vitest';
import { stringify } from 'yaml';
import {
  kubeApplicationName,
  kubeSecretName,
  projectApplicationManifests,
  projectSecretManifest,
  type ApplicationProjectionRow,
  type KubeManifest,
} from '../src';
import type { KubeSecretEnvVariable } from '../src/kube-runtime.types';

interface DeploymentSpec {
  selector: { matchLabels: Record<string, string> };
  progressDeadlineSeconds: number;
  template: {
    metadata: { annotations: Record<string, string>; labels: Record<string, string> };
    spec: { automountServiceAccountToken: false; containers: DeploymentContainer[] };
  };
}

interface DeploymentContainer {
  env: KubeSecretEnvVariable[];
  readinessProbe?: { httpGet?: { path: string; port: string } | undefined } | undefined;
}

describe('Kubernetes manifest projection goldens', (): void => {
  it('projects an application row to the T1 workload bundle', (): void => {
    const manifests: KubeManifest[] = projectApplicationManifests({
      containerPort: 8080,
      deploymentId: 'dep-01jz',
      environmentId: 'env-01jz',
      environmentName: 'Production',
      env: { LOG_LEVEL: 'info', FEATURE_FLAG: 'enabled' },
      image: 'registry.example/app@sha256:abc',
      imagePullSecretId: 'pull-01jz',
      namespaceId: 'prj-01jz',
      organizationId: 'org-01jz',
      organizationName: 'Acme',
      projectId: 'prj-01jz',
      projectName: 'Checkout',
      readiness: { path: '/healthz', timeoutMs: 60_000, type: 'http' },
      replicas: 2,
      serviceId: 'svc-01jz',
      serviceName: 'Web',
      secretId: 'sec-01jz',
      terminationGracePeriodSeconds: 45,
    });

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
    const manifests: KubeManifest[] = projectApplicationManifests(row);
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
    expect(spec.template.metadata.annotations['compartment.dev/secret-checksum']).toMatch(/^[a-f0-9]{64}$/);
  });

  it('changes the pod checksum only when Secret data changes', (): void => {
    const first: KubeManifest = deploymentFor({ ALPHA: 'one', ZETA: 'two' });
    const reordered: KubeManifest = deploymentFor({ ZETA: 'two', ALPHA: 'one' });
    const changed: KubeManifest = deploymentFor({ ALPHA: 'changed', ZETA: 'two' });
    const metadataChanged: KubeManifest = projectApplicationManifests({
      ...applicationRow({ ALPHA: 'one', ZETA: 'two' }),
      image: 'registry.example/other@sha256:generated',
      replicas: 3,
    }).find((manifest: KubeManifest): boolean => manifest.kind === 'Deployment')!;
    const checksum: (manifest: KubeManifest) => string | undefined = (manifest: KubeManifest): string | undefined =>
      (manifest.spec as DeploymentSpec).template.metadata.annotations['compartment.dev/secret-checksum'];
    expect(checksum(first)).toBe(checksum(reordered));
    expect(checksum(first)).toBe(checksum(metadataChanged));
    expect(checksum(first)).not.toBe(checksum(changed));
  });

  it('orders variable keys by locale-independent code-unit order', (): void => {
    const secret: KubeManifest = projectSecretManifest({
      data: { ä_KEY: 'generated-3', Z_KEY: 'generated-2', A_KEY: 'generated-1' },
      deploymentId: 'dep-order',
      namespaceId: 'prj-order',
      secretId: 'sec-order',
    });
    expect(Object.keys(secret.stringData ?? {})).toEqual(['A_KEY', 'Z_KEY', 'ä_KEY']);
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

  it('rejects a termination grace period below the admitted minimum', (): void => {
    expect((): KubeManifest[] =>
      projectApplicationManifests({ ...applicationRow({}), terminationGracePeriodSeconds: 44 }),
    ).toThrow('at least 45 seconds');
    expect(toYaml(projectApplicationManifests({ ...applicationRow({}), terminationGracePeriodSeconds: 60 }))).toContain(
      'terminationGracePeriodSeconds: 60',
    );
  });

  it('projects descriptor readiness and omits probes when readiness is disabled', (): void => {
    const configured: DeploymentSpec = deploymentForRow(applicationRow({})).spec as DeploymentSpec;
    const disabled: DeploymentSpec = deploymentForRow({ ...applicationRow({}), readiness: null })
      .spec as DeploymentSpec;

    expect(configured.progressDeadlineSeconds).toBe(60);
    expect(configured.template.spec.containers[0]?.readinessProbe?.httpGet).toEqual({
      path: '/healthz',
      port: 'http',
    });
    expect(disabled.template.spec.containers[0]?.readinessProbe).toBeUndefined();
  });

  it('keeps Deployment and Service identity stable while the candidate spec changes', (): void => {
    const firstRow: ApplicationProjectionRow = applicationRow({});
    const candidateRow: ApplicationProjectionRow = {
      ...applicationRow({}),
      deploymentId: 'dep-02jz',
      image: 'registry.example/app@sha256:next',
      secretId: 'sec-02jz',
    };
    const firstDeployment: KubeManifest = deploymentForRow(firstRow);
    const candidateDeployment: KubeManifest = deploymentForRow(candidateRow);
    const firstService: KubeManifest = serviceFor(firstRow);
    const candidateService: KubeManifest = serviceFor(candidateRow);

    expect(candidateDeployment.metadata?.name).toBe(firstDeployment.metadata?.name);
    expect(candidateService.metadata?.name).toBe(firstService.metadata?.name);
    expect(candidateDeployment.metadata?.name).toBe(candidateService.metadata?.name);
    expect(candidateDeployment.spec).not.toEqual(firstDeployment.spec);
    expect(JSON.stringify(candidateDeployment.spec)).toContain('registry.example/app@sha256:next');
    expect(candidateService.spec).toEqual(firstService.spec);
    expect(JSON.stringify(candidateService)).not.toContain('dep-02jz');
  });

  it('matches the provisioned application NetworkPolicy selector', (): void => {
    const deployment: DeploymentSpec = deploymentForRow(applicationRow({})).spec as DeploymentSpec;
    const service: KubeManifest = serviceFor(applicationRow({}));

    expect(deployment.selector.matchLabels).toMatchObject({ app: 'application' });
    expect(deployment.template.metadata.labels).toMatchObject({ app: 'application' });
    expect(service.spec).toMatchObject({ selector: { app: 'application' } });
  });
});

function deploymentFor(env: Readonly<Record<string, string>>): KubeManifest {
  return deploymentForRow(applicationRow(env));
}

function deploymentForRow(row: ApplicationProjectionRow): KubeManifest {
  return projectApplicationManifests(row).find((manifest: KubeManifest): boolean => manifest.kind === 'Deployment')!;
}

function serviceFor(row: ApplicationProjectionRow): KubeManifest {
  return projectApplicationManifests(row).find((manifest: KubeManifest): boolean => manifest.kind === 'Service')!;
}

function applicationRow(env: Readonly<Record<string, string>>): ApplicationProjectionRow {
  return {
    containerPort: 8080,
    deploymentId: 'dep-01jz',
    environmentId: 'env-01jz',
    environmentName: 'Production',
    env,
    image: 'registry.example/app@sha256:generated',
    imagePullSecretId: 'pull-01jz',
    namespaceId: 'prj-01jz',
    organizationId: 'org-01jz',
    organizationName: 'Generated',
    projectId: 'prj-01jz',
    projectName: 'Generated',
    readiness: { path: '/healthz', timeoutMs: 60_000, type: 'http' },
    replicas: 1,
    secretId: 'sec-01jz',
    serviceId: 'svc-01jz',
    serviceName: 'Web',
    terminationGracePeriodSeconds: 45,
  };
}

function toYaml(manifests: KubeManifest[]): string {
  return manifests
    .map((manifest: KubeManifest): string => stringify(manifest, { sortMapEntries: true }).trim())
    .join('\n---\n')
    .replaceAll(/[a-f0-9]{64}/g, '<sha256>');
}
