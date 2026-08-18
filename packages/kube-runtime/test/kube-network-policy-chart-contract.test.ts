import { execFileSync, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseAllDocuments } from 'yaml';
import { projectNetworkPolicyManifests } from '../src/kube-network-policy-projection';
import type { ProjectNetworkPolicyProjection } from '../src/kube-network-policy-projection.types';
import { applyObject } from '../src/kube-runtime-operations';
import type { KubeManifest } from '../src/kube-runtime.types';
import { CapturingKubernetesObjectApi } from './kube-transport-capture.harness';

const repositoryRoot: string = resolve(__dirname, '../../..');
const chartPath: string = resolve(repositoryRoot, 'deploy/chart/compartment');
const helmAvailable: boolean = spawnSync('helm', ['version', '--short'], { encoding: 'utf8' }).status === 0;
const podCidr: string = ['10', '42', '0', '0/16'].join('.');
const serviceCidr: string = ['10', '43', '0', '0/16'].join('.');

describe('Caddy readiness NetworkPolicy contract', (): void => {
  it.skipIf(process.env.CI !== 'true')('has Helm available in CI', (): void => {
    expect(helmAvailable).toBe(true);
  });

  it.skipIf(!helmAvailable)('matches the tenant policies serialized to the Kubernetes API', async (): Promise<void> => {
    const chartPolicies: KubeManifest[] = renderChartPolicies();
    const projectedPolicies: KubeManifest[] = projectNetworkPolicyManifests(
      'cpt-readiness',
      'readiness',
      'readiness',
      projection(),
    );

    for (const policy of ['default-deny', 'application-ingress']) {
      const chartPolicy: KubeManifest = requirePolicy(chartPolicies, `-${policy}`);
      const projectedPolicy: KubeManifest = requirePolicy(projectedPolicies, `np-${policy}-`);
      const serializedPolicy: KubeManifest = await serializePolicy(projectedPolicy);

      expect(chartPolicy.spec).toEqual(serializedPolicy.spec);
    }
  });
});

function renderChartPolicies(): KubeManifest[] {
  const output: string = execFileSync(
    'helm',
    [
      'template',
      'compartment',
      chartPath,
      '--namespace',
      'compartment',
      '--show-only',
      'templates/caddy-readiness.yaml',
      '--values',
      resolve(chartPath, 'tests/registry-values.yaml'),
      '--values',
      resolve(chartPath, 'tests/node-pools-values.yaml'),
      '--set',
      'platform.startupStage=full',
      '--set',
      'platform.installationId=caddy-readiness-contract',
      '--set',
      'platform.baseDomain=apps.example.com',
    ],
    { encoding: 'utf8' },
  );

  return parseAllDocuments(output)
    .map((document): KubeManifest => document.toJS() as KubeManifest)
    .filter((manifest: KubeManifest): boolean => manifest.kind === 'NetworkPolicy');
}

function requirePolicy(policies: KubeManifest[], nameFragment: string): KubeManifest {
  const policy: KubeManifest | undefined = policies.find(
    (candidate: KubeManifest): boolean => candidate.metadata?.name?.includes(nameFragment) === true,
  );
  if (policy === undefined) {
    throw new Error(`Expected a rendered NetworkPolicy whose name contains ${nameFragment}.`);
  }
  return policy;
}

async function serializePolicy(policy: KubeManifest): Promise<KubeManifest> {
  const objectApi: CapturingKubernetesObjectApi = new CapturingKubernetesObjectApi(
    `/apis/networking.k8s.io/v1/namespaces/cpt-readiness/networkpolicies/${policy.metadata?.name ?? ''}`,
  );
  await applyObject(objectApi, policy, false);
  return JSON.parse(objectApi.body ?? '{}') as KubeManifest;
}

function projection(): ProjectNetworkPolicyProjection {
  return {
    applicationPodLabels: {
      'app.kubernetes.io/component': 'caddy-readiness',
      'app.kubernetes.io/instance': 'compartment',
      'app.kubernetes.io/name': 'compartment',
    },
    applicationPorts: [8080],
    edgeNamespaceName: 'compartment',
    edgePodLabels: {
      'app.kubernetes.io/component': 'caddy',
      'app.kubernetes.io/instance': 'compartment',
      'app.kubernetes.io/name': 'compartment',
    },
    podCidr,
    resourcePodLabels: {},
    resourcePorts: [],
    serviceCidr,
  };
}
