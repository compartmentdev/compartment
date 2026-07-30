import { describe, expect, it } from 'vitest';
import { kubeJobManifest } from '../src/kube-job-projection';
import type { KubeJobManifest, KubeJobSpec } from '../src/kube-runtime.types';

describe('sandboxed build Job projection', (): void => {
  it('projects rootless BuildKit as a native sidecar inside the gVisor Job pod', (): void => {
    const manifest: KubeJobManifest = kubeJobManifest(buildJobSpec(), 'job-art-123', {
      'compartment.dev/job-class': 'build',
    });

    expect(manifest.spec!.template.spec).toMatchObject({
      automountServiceAccountToken: false,
      containers: [
        {
          image: 'compartment-worker@sha256:runner',
          name: 'job',
          securityContext: {
            allowPrivilegeEscalation: false,
            capabilities: { drop: ['ALL'] },
            privileged: false,
          },
        },
      ],
      initContainers: [
        {
          image: 'moby/buildkit@sha256:builder',
          name: 'buildkit',
          restartPolicy: 'Always',
          securityContext: {
            allowPrivilegeEscalation: true,
            appArmorProfile: { type: 'Unconfined' },
            readOnlyRootFilesystem: true,
            runAsGroup: 1000,
            runAsNonRoot: true,
            runAsUser: 1000,
          },
        },
      ],
      priorityClassName: 'compartment-platform',
      runtimeClassName: 'gvisor',
      securityContext: {
        fsGroup: 1000,
        fsGroupChangePolicy: 'OnRootMismatch',
        seccompProfile: { type: 'Unconfined' },
      },
    });
    expect(manifest.spec!.template.spec.volumes).toEqual([
      { emptyDir: {}, name: 'buildkit-data' },
      { emptyDir: {}, name: 'tmp' },
    ]);
  });
});

function buildJobSpec(): KubeJobSpec {
  return {
    emptyDirVolumes: [{ name: 'buildkit-data' }, { containerMountPath: '/tmp', name: 'tmp' }],
    env: { BUILD_INPUT: 'secret' },
    id: 'art_123',
    image: 'compartment-worker@sha256:runner',
    jobClass: 'build',
    labels: { 'compartment.dev/job-class': 'build' },
    namespace: 'compartment-build',
    priorityClassName: 'compartment-platform',
    scheduling: { nodeSelector: {}, runtimeClassName: 'gvisor', tolerations: [] },
    securityProfile: 'restricted',
    sidecars: [
      {
        args: ['--addr', 'tcp://127.0.0.1:1234', '--oci-worker-no-process-sandbox'],
        env: { HOME: '/home/user' },
        image: 'moby/buildkit@sha256:builder',
        name: 'buildkit',
        securityProfile: 'rootless-buildkit',
        volumeMounts: [{ mountPath: '/home/user/.local/share/buildkit', name: 'buildkit-data' }],
      },
    ],
    timeoutMs: 900000,
  };
}
