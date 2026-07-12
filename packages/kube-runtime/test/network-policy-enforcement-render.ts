import { stringify } from 'yaml';
import type { KubeManifest } from '../src';
import { projectNetworkPolicyManifests } from '../src/kube-network-policy-projection';

const podCidr: string = process.argv[2] ?? '';
const serviceCidr: string = process.argv[3] ?? '';
if (podCidr.length === 0 || serviceCidr.length === 0) {
  throw new Error('usage: network-policy-enforcement-render.ts <pod-cidr> <service-cidr>');
}

const manifests: KubeManifest[] = projectNetworkPolicyManifests('ns-a', 't2-namespace', 't2-project', {
  applicationPodLabels: { 'compartment.test/role': 'application' },
  applicationPort: 8080,
  edgeNamespaceId: 'platform-ns',
  edgePodLabels: { app: 'caddy' },
  podCidr,
  resourcePodLabels: { app: 'resource' },
  resourcePort: 8080,
  serviceCidr,
});

process.stdout.write(
  `${manifests.map((manifest: KubeManifest): string => stringify(manifest).trim()).join('\n---\n')}\n`,
);
