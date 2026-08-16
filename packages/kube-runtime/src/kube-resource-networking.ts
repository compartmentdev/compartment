import type { KubeContainerPort } from './kube-application-projection.types';
import type { ResourceProjectionRow } from './kube-resource-projection.types';
import type { KubeManifest, KubeServicePort } from './kube-runtime.types';

export function resourceContainerPort(port: number): KubeContainerPort {
  return { containerPort: port, name: resourcePortName(port), protocol: 'TCP' };
}

export function resourceService(
  row: ResourceProjectionRow,
  labels: Record<string, string>,
  name: string,
  namespace: string,
): KubeManifest {
  return {
    apiVersion: 'v1',
    kind: 'Service',
    metadata: { labels, name, namespace },
    spec: {
      clusterIP: 'None',
      ports: row.ports.map(
        (port: number): KubeServicePort => ({
          name: resourcePortName(port),
          port,
          protocol: 'TCP',
          targetPort: port,
        }),
      ),
      selector: labels,
    },
  };
}

function resourcePortName(port: number): string {
  return `tcp-${port}`;
}
