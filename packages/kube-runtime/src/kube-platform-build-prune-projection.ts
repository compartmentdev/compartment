import {
  componentLabels,
  restrictedContainerSecurityContext,
  restrictedPodSecurityContext,
  workloadResources,
} from './kube-platform-build-projection-support';
import type { PlatformBuildProjectionInput } from './kube-platform-build-projection.types';
import type { KubeManifest } from './kube-runtime.types';

export function platformBuildPruneCronJob(input: PlatformBuildProjectionInput, namespace: string): KubeManifest {
  return {
    apiVersion: 'batch/v1',
    kind: 'CronJob',
    metadata: { labels: { 'app.kubernetes.io/managed-by': 'compartment' }, name: 'buildkit-prune', namespace },
    spec: {
      jobTemplate: {
        spec: { template: { metadata: { labels: componentLabels('prune') }, spec: prunePodSpec(input) } },
      },
      schedule: '0 3 * * *',
    },
  };
}

function prunePodSpec(input: PlatformBuildProjectionInput): object {
  return {
    automountServiceAccountToken: false,
    containers: [
      {
        args: pruneArgs(),
        command: ['buildctl'],
        env: [],
        image: input.buildkitImage,
        name: 'prune',
        resources: workloadResources('50m', '64Mi', '100m', '128Mi'),
        securityContext: restrictedContainerSecurityContext(),
      },
    ],
    restartPolicy: 'OnFailure',
    securityContext: restrictedPodSecurityContext(),
  };
}

function pruneArgs(): string[] {
  return ['--addr', 'tcp://buildkit:1234', 'prune', '--all', '--keep-duration', '24h', '--keep-storage', '2000'];
}
