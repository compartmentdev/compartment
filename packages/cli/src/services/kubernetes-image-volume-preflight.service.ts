import { z } from 'zod';
import type { JsonValue } from '@compartment/utils';
import { runCommandWithInput } from '../command-runner';
import type { CommandResult } from '../command-runner.types';
import { buildKubectlCommand, readCommandOutput } from './kubernetes-command.support';
import type { KubernetesImageVolumeCapabilityTarget } from './kubernetes-image-volume-preflight.service.types';

const imageVolumeName: string = 'image-volume';
const probeImage: string = 'registry.k8s.io/pause:3.10.1';
const imageVolumePodSchema = z.object({
  spec: z.object({
    containers: z.array(
      z.object({
        name: z.string(),
        volumeMounts: z.array(z.object({ name: z.string() })).optional(),
      }),
    ),
    volumes: z
      .array(
        z.object({
          image: z.object({ reference: z.string() }).optional(),
          name: z.string(),
        }),
      )
      .optional(),
  }),
});

export async function assertKubernetesImageVolumeCapability(
  target: KubernetesImageVolumeCapabilityTarget,
): Promise<void> {
  const result: CommandResult = await runCommandWithInput(
    buildKubectlCommand(target, ['create', '--dry-run=server', '--filename=-', '--output=json']),
    buildImageVolumeProbePod(),
  );
  if (result.exitCode !== 0) {
    throw new Error(`Kubernetes ImageVolume capability probe failed: ${readCommandOutput(result)}`);
  }
  const parsed = imageVolumePodSchema.safeParse(readJson(result.stdout));
  const podSpec = parsed.success ? parsed.data.spec : undefined;
  const imageVolumePresent: boolean =
    podSpec?.volumes?.some(
      (volume): boolean => volume.name === imageVolumeName && volume.image?.reference === probeImage,
    ) ?? false;
  const imageMountPresent: boolean =
    podSpec?.containers.some(
      (container): boolean =>
        container.name === 'probe' &&
        (container.volumeMounts?.some((mount): boolean => mount.name === imageVolumeName) ?? false),
    ) ?? false;
  if (!imageVolumePresent || !imageMountPresent) {
    throw new Error(
      'Kubernetes removed the ImageVolume or its mount during server-side dry-run. Use Kubernetes 1.35 or newer, or enable ImageVolume=true on kube-apiserver and every eligible kubelet before installing or updating Compartment.',
    );
  }
}

function buildImageVolumeProbePod(): string {
  return JSON.stringify({
    apiVersion: 'v1',
    kind: 'Pod',
    metadata: { name: 'compartment-image-volume-preflight', namespace: 'default' },
    spec: {
      containers: [
        {
          image: probeImage,
          name: 'probe',
          volumeMounts: [{ mountPath: '/image', name: imageVolumeName, readOnly: true }],
        },
      ],
      restartPolicy: 'Never',
      volumes: [
        {
          image: { pullPolicy: 'IfNotPresent', reference: probeImage },
          name: imageVolumeName,
        },
      ],
    },
  });
}

function readJson(value: string): JsonValue {
  try {
    return JSON.parse(value) as JsonValue;
  } catch {
    return null;
  }
}
