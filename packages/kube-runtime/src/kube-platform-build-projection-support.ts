const managedLabels: Readonly<Record<string, string>> = { 'app.kubernetes.io/managed-by': 'compartment' };

export function componentLabels(name: string): Record<string, string> {
  return { ...managedLabels, 'app.kubernetes.io/name': name };
}

export function workloadResources(
  requestCpu: string,
  requestMemory: string,
  limitCpu: string,
  limitMemory: string,
): object {
  return { limits: { cpu: limitCpu, memory: limitMemory }, requests: { cpu: requestCpu, memory: requestMemory } };
}

export function buildkitPodSecurityContext(): object {
  return { fsGroup: 1000, fsGroupChangePolicy: 'OnRootMismatch', seccompProfile: { type: 'Unconfined' } };
}

export function buildkitContainerSecurityContext(): object {
  return {
    allowPrivilegeEscalation: true,
    appArmorProfile: { type: 'Unconfined' },
    readOnlyRootFilesystem: true,
    runAsGroup: 1000,
    runAsNonRoot: true,
    runAsUser: 1000,
  };
}

export function restrictedPodSecurityContext(): object {
  return {
    fsGroup: 1000,
    runAsGroup: 1000,
    runAsNonRoot: true,
    runAsUser: 1000,
    seccompProfile: { type: 'RuntimeDefault' },
  };
}

export function restrictedContainerSecurityContext(): object {
  return {
    allowPrivilegeEscalation: false,
    capabilities: { drop: ['ALL'] },
    readOnlyRootFilesystem: true,
    runAsGroup: 1000,
    runAsNonRoot: true,
    runAsUser: 1000,
  };
}
