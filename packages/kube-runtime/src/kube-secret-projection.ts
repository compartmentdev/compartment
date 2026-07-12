import { createHash } from 'node:crypto';
import { compareKubeKey } from './kube-key-order';
import { kubeNamespaceName, kubeSecretName } from './kube-naming';
import type { KubeManifest, KubeSecretEnvVariable, SecretProjectionRow } from './kube-runtime.types';

const managedByLabel: Readonly<Record<string, string>> = { 'app.kubernetes.io/managed-by': 'compartment' };

export function projectSecretManifest(row: SecretProjectionRow): KubeManifest {
  const orderedData: Record<string, string> = orderedSecretData(row.data);
  return {
    apiVersion: 'v1',
    kind: 'Secret',
    metadata: {
      annotations: { 'compartment.dev/checksum': secretChecksum(orderedData) },
      labels: {
        ...managedByLabel,
        'compartment.dev/deployment-id': row.deploymentId,
        'compartment.dev/secret-id': row.secretId,
      },
      name: kubeSecretName(row.secretId),
      namespace: kubeNamespaceName(row.namespaceId),
    },
    stringData: orderedData,
    type: 'Opaque',
  };
}

export function secretEnvironment(data: Readonly<Record<string, string>>, secretName: string): KubeSecretEnvVariable[] {
  return Object.keys(data)
    .sort(compareKubeKey)
    .map(
      (name: string): KubeSecretEnvVariable => ({
        name,
        valueFrom: { secretKeyRef: { key: name, name: secretName } },
      }),
    );
}

export function secretChecksum(data: Readonly<Record<string, string>>): string {
  return createHash('sha256')
    .update(JSON.stringify(orderedSecretData(data)))
    .digest('hex');
}

function orderedSecretData(data: Readonly<Record<string, string>>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(data).sort(([left]: [string, string], [right]: [string, string]): number =>
      compareKubeKey(left, right),
    ),
  );
}
