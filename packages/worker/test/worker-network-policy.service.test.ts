import {
  defaultApplicationPorts,
  type DeploymentReconcileProjection,
  type DeploymentReconcileTarget,
  type ProjectNetworkPolicyPorts,
} from '@compartment/contracts';
import {
  projectApplicationManifests,
  type ApplyBundle,
  type KubeManifest,
  type KubeRuntime,
} from '@compartment/kube-runtime';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { applyApplication } from '../src/services/worker-deployment-application.service';
import {
  applyProjectNetworkPolicies,
  projectProjectNetworkPolicyManifests,
} from '../src/services/worker-network-policy.service';
import { decryptTenantProjection } from '../src/tenant-workload-projections';
import { encryptTestTenantEnvironment, testTenantSecretsKek } from './tenant-secret-test.fixtures';

interface NetworkPolicyRule {
  from?: NetworkPolicyPeer[] | undefined;
  ports?: NetworkPolicyRulePort[] | undefined;
}

interface NetworkPolicyPeer {
  namespaceSelector?: NetworkPolicySelector | undefined;
  podSelector?: NetworkPolicySelector | undefined;
}

interface NetworkPolicySelector {
  matchLabels?: Record<string, string> | undefined;
}

interface NetworkPolicyRulePort {
  port: number;
}

interface NetworkPolicySpec {
  egress?: NetworkPolicyRule[] | undefined;
  ingress?: NetworkPolicyRule[] | undefined;
}

interface ApplicationDeploymentContainer {
  ports: ApplicationDeploymentContainerPort[];
}

interface ApplicationDeploymentContainerPort {
  containerPort: number;
  name: string;
}

interface ApplicationDeploymentSpec {
  template: {
    spec: {
      containers: ApplicationDeploymentContainer[];
    };
  };
}

interface ApplicationServicePort {
  name: string;
  targetPort: number;
}

interface ApplicationServiceSpec {
  ports: ApplicationServicePort[];
}

describe('worker NetworkPolicy desired state', (): void => {
  beforeEach((): void => {
    process.env.COMPARTMENT_EDGE_NAMESPACE = 'platform';
    process.env.COMPARTMENT_KUBE_POD_CIDR = ['10', '42', '0', '0/16'].join('.');
    process.env.COMPARTMENT_KUBE_SERVICE_CIDR = ['10', '43', '0', '0/16'].join('.');
  });

  it('projects the claimed application port set', (): void => {
    expect(readPolicyPorts(applicationPolicyManifests([8080]), 'application-ingress', 'ingress')).toEqual([8080]);
  });

  it('admits only the platform Caddy proxy into tenant application Pods', (): void => {
    const ingress: NetworkPolicyRule[] = readPolicyIngress(applicationPolicyManifests([8080]), 'application-ingress');

    expect(ingress).toHaveLength(1);
    expect(ingress[0]?.from).toEqual([
      {
        namespaceSelector: { matchLabels: { 'kubernetes.io/metadata.name': 'platform' } },
        podSelector: { matchLabels: { 'app.kubernetes.io/component': 'caddy' } },
      },
    ]);
  });

  it('uses the descriptor default serving port for policy, Deployment, and Service', (): void => {
    const projection: DeploymentReconcileProjection = defaultApplicationProjection();
    const applicationManifests: KubeManifest[] = projectApplicationManifests(
      decryptTenantProjection(projection, undefined, testTenantSecretsKek),
      600_000,
    );
    const deployment: KubeManifest = requiredManifest(applicationManifests, 'Deployment');
    const service: KubeManifest = requiredManifest(applicationManifests, 'Service');
    const deploymentSpec: ApplicationDeploymentSpec = deployment.spec as ApplicationDeploymentSpec;
    const serviceSpec: ApplicationServiceSpec = service.spec as ApplicationServiceSpec;

    expect(
      readPolicyPorts(applicationPolicyManifests(projection.containerPorts), 'application-ingress', 'ingress'),
    ).toEqual(defaultApplicationPorts);
    expect(
      deploymentSpec.template.spec.containers[0]?.ports.find(
        (port: ApplicationDeploymentContainerPort): boolean => port.name === 'http',
      )?.containerPort,
    ).toBe(defaultApplicationPorts[0]);
    expect(serviceSpec.ports.find((port: ApplicationServicePort): boolean => port.name === 'http')?.targetPort).toBe(
      defaultApplicationPorts[0],
    );
  });

  it('applies the current resource port for both ingress and application egress', async (): Promise<void> => {
    const { apply, runtime }: { apply: Mock; runtime: KubeRuntime } = identityApplyRuntime();

    await applyProjectNetworkPolicies(runtime, 'project', { applicationPorts: [8080], resourcePorts: [5432] });

    const manifests: KubeManifest[] = appliedManifests(apply, 0);

    expect(readPolicyPorts(manifests, 'resource-ingress', 'ingress')).toEqual([5432]);
    expect(readPolicyPorts(manifests, 'application-egress', 'egress')).toContain(5432);
  });

  it('keeps the projected spec identical across interleaved resource and deployment applies', async (): Promise<void> => {
    const ports: ProjectNetworkPolicyPorts = { applicationPorts: [8080], resourcePorts: [5432] };
    const { apply: resourceApply, runtime: resourceRuntime }: { apply: Mock; runtime: KubeRuntime } =
      identityApplyRuntime();
    const { apply: deploymentApply, runtime: deploymentRuntime }: { apply: Mock; runtime: KubeRuntime } =
      identityApplyRuntime();

    await applyProjectNetworkPolicies(resourceRuntime, 'project', ports);
    await applyApplication(deploymentRuntime, deploymentTarget(ports), testTenantSecretsKek, 600_000, undefined);
    await applyProjectNetworkPolicies(resourceRuntime, 'project', ports);

    const resourcePolicies: KubeManifest[] = policyManifests(appliedManifests(resourceApply, 0));
    const deploymentPolicies: KubeManifest[] = policyManifests(appliedManifests(deploymentApply, 0));

    expect(readPolicyPorts(deploymentPolicies, 'resource-ingress', 'ingress')).toEqual([5432]);
    expect(readPolicyPorts(deploymentPolicies, 'application-ingress', 'ingress')).toEqual([8080]);
    expect(deploymentPolicies).toEqual(resourcePolicies);
    expect(policyManifests(appliedManifests(resourceApply, 1))).toEqual(resourcePolicies);
  });
});

function defaultApplicationProjection(): DeploymentReconcileProjection {
  const servingPort: number = defaultApplicationPorts[0]!;
  return {
    containerPorts: [...defaultApplicationPorts],
    deploymentId: 'deployment',
    environmentId: 'environment',
    environmentName: 'production',
    env: encryptTestTenantEnvironment({ PORT: servingPort.toString() }),
    image: 'registry.example/app@sha256:default',
    imagePullSecretId: 'project',
    namespaceId: 'project',
    organizationId: 'organization',
    organizationName: 'Acme',
    projectId: 'project',
    projectName: 'app',
    readiness: { path: '/healthz', timeoutMs: 60_000, type: 'http' },
    releaseCommand: null,
    replicas: 1,
    runCommand: null,
    secretId: 'deployment',
    serviceId: 'service',
    serviceName: 'web',
    terminationGracePeriodSeconds: 45,
  };
}

function requiredManifest(manifests: KubeManifest[], kind: string): KubeManifest {
  const manifest: KubeManifest | undefined = manifests.find(
    (candidate: KubeManifest): boolean => candidate.kind === kind,
  );
  if (manifest === undefined) {
    throw new Error(`Expected ${kind} manifest.`);
  }
  return manifest;
}

function applicationPolicyManifests(applicationPorts: number[]): KubeManifest[] {
  return projectProjectNetworkPolicyManifests('project', { applicationPorts, resourcePorts: [] });
}

function identityApplyRuntime(): { apply: Mock; runtime: KubeRuntime } {
  const apply: Mock = vi.fn(
    async (bundle: ApplyBundle): Promise<KubeManifest[]> => await Promise.resolve(bundle.objects),
  );
  return { apply, runtime: { apply, read: async (): Promise<null> => await Promise.resolve(null) } as never };
}

function appliedManifests(apply: Mock, call: number): KubeManifest[] {
  return (apply.mock.calls[call]?.[0] as ApplyBundle).objects;
}

function policyManifests(manifests: KubeManifest[]): KubeManifest[] {
  return manifests.filter((manifest: KubeManifest): boolean => manifest.kind === 'NetworkPolicy');
}

function deploymentTarget(networkPolicy: ProjectNetworkPolicyPorts): DeploymentReconcileTarget {
  return {
    active: null,
    candidate: defaultApplicationProjection(),
    networkPolicy,
    revision: 1,
    rolloutStartedAt: new Date(0).toISOString(),
    state: 'desired',
  };
}

function requiredPolicySpec(manifests: KubeManifest[], policyNameSuffix: string): NetworkPolicySpec {
  const manifest: KubeManifest | undefined = manifests.find(
    (candidate: KubeManifest): boolean => candidate.metadata?.name?.includes(`np-${policyNameSuffix}`) === true,
  );
  if (manifest === undefined) {
    throw new Error(`Expected np-${policyNameSuffix} manifest.`);
  }
  return manifest.spec as NetworkPolicySpec;
}

function readPolicyPorts(
  manifests: KubeManifest[],
  policyNameSuffix: string,
  direction: 'egress' | 'ingress',
): number[] {
  return (requiredPolicySpec(manifests, policyNameSuffix)[direction] ?? []).flatMap(
    (rule: NetworkPolicyRule): number[] => rule.ports?.map((port: NetworkPolicyRulePort): number => port.port) ?? [],
  );
}

function readPolicyIngress(manifests: KubeManifest[], policyNameSuffix: string): NetworkPolicyRule[] {
  return requiredPolicySpec(manifests, policyNameSuffix).ingress ?? [];
}
