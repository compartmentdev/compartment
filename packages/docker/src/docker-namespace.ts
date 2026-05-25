export const compartmentDockerNamespaceLabelName: string = 'compartment.namespace';

export function buildDockerNamespaceLabels(namespace: string): Record<string, string> {
  return {
    [compartmentDockerNamespaceLabelName]: namespace,
  };
}
