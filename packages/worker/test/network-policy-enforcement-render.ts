import { projectNetworkPolicyManifests, type KubeManifest } from '@compartment/kube-runtime';
import { dumpYaml } from '@kubernetes/client-node';
import { projectNetworkPolicy } from '../src/project-network-policy';

const podCidr: string = process.argv[2] ?? '';
const serviceCidr: string = process.argv[3] ?? '';
if (podCidr.length === 0 || serviceCidr.length === 0) {
  throw new Error('usage: network-policy-enforcement-render.ts <pod-cidr> <service-cidr>');
}

// The enforcement gate must probe the peers production ships. Restating the Pod labels here let a
// wrong peer agree with the fixtures and pass, so the projection comes from the production mapper.
// `dumpYaml` is the client serializer `apply` uses, so the gate applies the bytes production sends
// instead of the in-memory manifest shape.
const manifests: KubeManifest[] = projectNetworkPolicyManifests(
  'ns-a',
  't2-namespace',
  't2-project',
  projectNetworkPolicy(
    {
      COMPARTMENT_EDGE_NAMESPACE: 'platform-ns',
      COMPARTMENT_KUBE_POD_CIDR: podCidr,
      COMPARTMENT_KUBE_SERVICE_CIDR: serviceCidr,
    },
    { applicationPorts: [8080], resourcePorts: [6379, 8080] },
  ),
);

process.stdout.write(
  `${manifests.map((manifest: KubeManifest): string => dumpYaml(manifest).trim()).join('\n---\n')}\n`,
);
