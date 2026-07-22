import { parse } from 'yaml';
import type { JsonValue } from '@compartment/utils';
import { describe, expect, it } from 'vitest';
import {
  createKubernetesRegistryMirror,
  isLocalK3sKubeconfigChain,
  mergeKubernetesRegistryMirrorConfig,
  renderKubernetesRegistryMirrorConfig,
} from '../src/services/kubernetes-registry-mirror-config.service';
import { renderKubernetesRegistryMirrorInstructions } from '../src/services/kubernetes-registry-mirror.service';
import type { KubernetesRegistryMirror } from '../src/services/kubernetes-registry-mirror.service.types';

const serviceClusterIp: string = ['10', '43', '210', '17'].join('.');
const staleClusterIp: string = ['10', '43', '99', '8'].join('.');
const registryMirror: KubernetesRegistryMirror = createKubernetesRegistryMirror(
  'compartment-compartment-registry-auth',
  'compartment',
  serviceClusterIp,
);

describe('Kubernetes registry mirror setup', (): void => {
  it('renders the exact k3s registry mirror format for the installed Service', (): void => {
    expect(renderKubernetesRegistryMirrorConfig(registryMirror)).toBe(
      `mirrors:
  "compartment-compartment-registry-auth.compartment.svc:5000":
    endpoint:
      - "http://${serviceClusterIp}:5000"
`,
    );
    const instructions: string = renderKubernetesRegistryMirrorInstructions(registryMirror);
    expect(instructions).toContain(renderKubernetesRegistryMirrorConfig(registryMirror));
    expect(instructions).toContain('system registry-mirror apply');
    expect(instructions).toContain('runs systemctl restart k3s');
  });

  it('updates only the installed registry endpoint and keeps foreign registry configuration', (): void => {
    const existingConfig: string = `mirrors:
  "docker.io":
    endpoint:
      - "https://mirror.example.com"
  "compartment-compartment-registry-auth.compartment.svc:5000":
    endpoint:
      - "http://${staleClusterIp}:5000"
    rewrite:
      "^library/(.*)": "mirror/$1"
configs:
  "docker.io":
    tls:
      insecure_skip_verify: true
`;

    const mergedConfig: string = mergeKubernetesRegistryMirrorConfig(existingConfig, registryMirror);
    const parsedConfig: JsonValue = parse(mergedConfig) as JsonValue;

    expect(parsedConfig).toEqual({
      configs: {
        'docker.io': { tls: { insecure_skip_verify: true } },
      },
      mirrors: {
        'compartment-compartment-registry-auth.compartment.svc:5000': {
          endpoint: [`http://${serviceClusterIp}:5000`],
          rewrite: { '^library/(.*)': 'mirror/$1' },
        },
        'docker.io': { endpoint: ['https://mirror.example.com'] },
      },
    });
    expect(mergeKubernetesRegistryMirrorConfig(mergedConfig, registryMirror)).toBe(mergedConfig);
  });

  it('does not auto-apply for the k3d harness kubeconfig or an ambiguous kubeconfig chain', (): void => {
    expect(isLocalK3sKubeconfigChain({}, undefined)).toBe(false);
    expect(isLocalK3sKubeconfigChain({ KUBECONFIG: '/tmp/compartment-k3d/kubeconfig.yaml' }, undefined)).toBe(false);
    expect(
      isLocalK3sKubeconfigChain(
        {
          KUBECONFIG: `/etc/rancher/k3s/k3s.yaml${process.platform === 'win32' ? ';' : ':'}/tmp/other.yaml`,
        },
        undefined,
      ),
    ).toBe(false);
    expect(isLocalK3sKubeconfigChain({ KUBECONFIG: '/etc/rancher/k3s/k3s.yaml' }, 'remote')).toBe(false);
    expect(isLocalK3sKubeconfigChain({ KUBECONFIG: '/etc/rancher/k3s/k3s.yaml' }, undefined)).toBe(true);
  });
});
