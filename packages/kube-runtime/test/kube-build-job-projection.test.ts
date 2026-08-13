import { describe, expect, it } from 'vitest';
import { kubeJobManifest } from '../src/kube-job-projection';
import type { KubeJobManifest, KubeJobSpec } from '../src/kube-runtime.types';

describe('sandboxed build Job projection', (): void => {
  it('projects bounded tmpfs BuildKit state, tenant priority, and fail-closed security inside the gVisor Job pod', (): void => {
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
            readOnlyRootFilesystem: true,
            runAsGroup: 10001,
            runAsNonRoot: true,
            runAsUser: 10001,
          },
        },
      ],
      initContainers: [
        {
          command: ['/usr/local/bin/buildkitd'],
          image: 'compartment-worker@sha256:runner',
          name: 'buildkit',
          restartPolicy: 'Always',
          securityContext: {
            allowPrivilegeEscalation: false,
            capabilities: {
              add: [
                'AUDIT_WRITE',
                'CHOWN',
                'DAC_OVERRIDE',
                'FOWNER',
                'FSETID',
                'KILL',
                'MKNOD',
                'NET_BIND_SERVICE',
                'NET_RAW',
                'SETFCAP',
                'SETGID',
                'SETPCAP',
                'SETUID',
                'SYS_ADMIN',
                'SYS_CHROOT',
              ],
              drop: ['ALL'],
            },
            privileged: false,
            readOnlyRootFilesystem: true,
            runAsGroup: 0,
            runAsUser: 0,
          },
        },
      ],
      priorityClassName: 'compartment-tenant',
      runtimeClassName: 'gvisor',
      securityContext: {
        seccompProfile: { type: 'RuntimeDefault' },
      },
    });
    expect(manifest.spec!.template.metadata.annotations).toMatchObject({
      'dev.gvisor.spec.mount.buildkit-data.options': 'rw,rprivate',
      'dev.gvisor.spec.mount.buildkit-data.share': 'container',
      'dev.gvisor.spec.mount.buildkit-data.type': 'tmpfs',
      'dev.gvisor.spec.mount.tmp.options': 'rw,rprivate',
      'dev.gvisor.spec.mount.tmp.share': 'container',
      'dev.gvisor.spec.mount.tmp.type': 'tmpfs',
    });
    expect(manifest.spec!.template.spec.volumes).toEqual([
      { configMap: { name: 'compartment-buildkit' }, name: 'buildkit-config' },
      { emptyDir: { sizeLimit: '3Gi' }, name: 'buildkit-data' },
      { emptyDir: { sizeLimit: '1Gi' }, name: 'tmp' },
    ]);
  });

  it('rejects a gVisor BuildKit sidecar outside an explicitly sandboxed build Job', (): void => {
    const spec: KubeJobSpec = { ...buildJobSpec(), jobClass: 'operation' };

    expect((): KubeJobManifest => kubeJobManifest(spec, 'job-art-123', {})).toThrow(
      'gVisor BuildKit sidecars require a build Job with an explicit sandbox RuntimeClass',
    );
  });
});

function buildJobSpec(): KubeJobSpec {
  return {
    configMapVolumes: [{ configMapName: 'compartment-buildkit', name: 'buildkit-config' }],
    emptyDirVolumes: [
      { gvisorTmpfs: true, name: 'buildkit-data', sizeLimit: '3Gi' },
      { containerMountPath: '/tmp', gvisorTmpfs: true, name: 'tmp', sizeLimit: '1Gi' },
    ],
    env: { BUILD_INPUT: 'secret' },
    id: 'art_123',
    image: 'compartment-worker@sha256:runner',
    jobClass: 'build',
    labels: { 'compartment.dev/job-class': 'build' },
    namespace: 'compartment-build',
    scheduling: { nodeSelector: {}, runtimeClassName: 'gvisor', tolerations: [] },
    securityProfile: 'restricted',
    sidecars: [
      {
        args: ['--addr', 'tcp://127.0.0.1:1234', '--oci-worker=true'],
        command: ['/usr/local/bin/buildkitd'],
        env: { HOME: '/tmp' },
        image: 'compartment-worker@sha256:runner',
        name: 'buildkit',
        volumeMounts: [
          { mountPath: '/var/lib/buildkit', name: 'buildkit-data' },
          {
            mountPath: '/etc/buildkit/buildkitd.toml',
            name: 'buildkit-config',
            readOnly: true,
            subPath: 'buildkitd.toml',
          },
        ],
      },
    ],
    timeoutMs: 900000,
  };
}
