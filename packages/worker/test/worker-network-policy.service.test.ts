import {
  defaultApplicationPorts,
  type DeploymentReconcileProjection,
  type ProjectNetworkPolicyPorts,
} from '@compartment/contracts';
import {
  projectApplicationManifests,
  type ApplyBundle,
  type KubeManifest,
  type KubeRuntime,
} from '@compartment/kube-runtime';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import {
  applyResourceNetworkPolicy,
  includeApplicationNetworkPolicyPorts,
  projectProjectNetworkPolicyManifests,
} from '../src/services/worker-network-policy.service';

interface NetworkPolicyRule {
  ports?: NetworkPolicyRulePort[] | undefined;
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
    process.env.COMPARTMENT_EDGE_NAMESPACE = 'edge';
    process.env.COMPARTMENT_KUBE_POD_CIDR = ['10', '42', '0', '0/16'].join('.');
    process.env.COMPARTMENT_KUBE_SERVICE_CIDR = ['10', '43', '0', '0/16'].join('.');
  });

  it('projects the current deployment port even when the aggregate payload is stale', (): void => {
    const ports: ProjectNetworkPolicyPorts = includeApplicationNetworkPolicyPorts(
      { applicationPorts: [], resourcePorts: [] },
      [8080],
    );

    expect(
      readPolicyPorts(projectProjectNetworkPolicyManifests('project', ports), 'application-ingress', 'ingress'),
    ).toEqual([8080]);
  });

  it('uses the descriptor default serving port for policy, Deployment, and Service', (): void => {
    const projection: DeploymentReconcileProjection = defaultApplicationProjection();
    const applicationManifests: KubeManifest[] = projectApplicationManifests(projection);
    const deployment: KubeManifest = requiredManifest(applicationManifests, 'Deployment');
    const service: KubeManifest = requiredManifest(applicationManifests, 'Service');
    const deploymentSpec: ApplicationDeploymentSpec = deployment.spec as ApplicationDeploymentSpec;
    const serviceSpec: ApplicationServiceSpec = service.spec as ApplicationServiceSpec;
    const policyPorts: ProjectNetworkPolicyPorts = includeApplicationNetworkPolicyPorts(
      { applicationPorts: [], resourcePorts: [] },
      projection.containerPorts,
    );

    expect(
      readPolicyPorts(projectProjectNetworkPolicyManifests('project', policyPorts), 'application-ingress', 'ingress'),
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
    const apply: Mock = vi.fn(
      async (bundle: ApplyBundle): Promise<KubeManifest[]> => await Promise.resolve(bundle.objects),
    );
    const runtime: KubeRuntime = { apply } as never;

    await applyResourceNetworkPolicy(runtime, 'project', { applicationPorts: [8080], resourcePorts: [] }, [5432]);

    const bundle: ApplyBundle = apply.mock.calls[0]?.[0] as ApplyBundle;
    const manifests: KubeManifest[] = bundle.objects;

    expect(readPolicyPorts(manifests, 'resource-ingress', 'ingress')).toEqual([5432]);
    expect(readPolicyPorts(manifests, 'application-egress', 'egress')).toContain(5432);
  });
});

function defaultApplicationProjection(): DeploymentReconcileProjection {
  const servingPort: number = defaultApplicationPorts[0]!;
  return {
    containerPorts: [...defaultApplicationPorts],
    deploymentId: 'deployment',
    environmentId: 'environment',
    environmentName: 'production',
    env: { PORT: servingPort.toString() },
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

function readPolicyPorts(
  manifests: KubeManifest[],
  policyNameSuffix: string,
  direction: 'egress' | 'ingress',
): number[] {
  const manifest: KubeManifest | undefined = manifests.find(
    (candidate: KubeManifest): boolean => candidate.metadata?.name?.includes(`np-${policyNameSuffix}`) === true,
  );
  const spec: NetworkPolicySpec = manifest?.spec as NetworkPolicySpec;
  return (spec[direction] ?? []).flatMap(
    (rule: NetworkPolicyRule): number[] => rule.ports?.map((port: NetworkPolicyRulePort): number => port.port) ?? [],
  );
}
