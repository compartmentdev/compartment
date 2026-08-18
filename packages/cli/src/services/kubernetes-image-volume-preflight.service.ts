import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { JsonValue } from '@compartment/utils';
import { runCommandWithInput, runCommandWithTimeout } from '../command-runner';
import type { CommandResult } from '../command-runner.types';
import { buildKubectlCommand, formatKubernetesCommandFailure, readCommandOutput } from './kubernetes-command.support';
import type { KubernetesImageVolumeCapabilityTarget } from './kubernetes-image-volume-preflight.service.types';
import { readReadyKubernetesNodeNames } from './kubernetes-ready-nodes.service';

const imageVolumeName: string = 'image-volume';
const probeImage: string = 'postgres:16-alpine@sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777';
const canaryTimeoutMs: number = 5 * 60_000;
const canaryKubernetesTimeout: string = '4m';
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

export async function verifyKubernetesImageVolumeRuntime(target: KubernetesImageVolumeCapabilityTarget): Promise<void> {
  const nodeNames: string[] = await readReadyKubernetesNodeNames(target);
  if (nodeNames.length === 0) {
    throw new Error('No Ready schedulable Kubernetes nodes are available for ImageVolume runtime verification.');
  }
  await Promise.all(
    nodeNames.map(async (nodeName: string): Promise<void> => await runImageVolumeCanary(target, nodeName)),
  );
}

async function runImageVolumeCanary(target: KubernetesImageVolumeCapabilityTarget, nodeName: string): Promise<void> {
  const podName: string = `compartment-image-volume-${randomUUID()}`;
  let primaryFailure: Error | null = null;
  try {
    await applyImageVolumeCanary(target, podName, nodeName);
    await waitForImageVolumeCanary(target, podName, nodeName);
    await assertImageVolumeCanaryMount(target, podName, nodeName);
  } catch (error) {
    primaryFailure = error instanceof Error ? error : new Error('Kubernetes ImageVolume runtime canary failed.');
    throw primaryFailure;
  } finally {
    await deleteImageVolumeCanary(target, podName, primaryFailure);
  }
}

async function applyImageVolumeCanary(
  target: KubernetesImageVolumeCapabilityTarget,
  podName: string,
  nodeName: string,
): Promise<void> {
  const result: CommandResult = await runCommandWithInput(
    buildProbeKubectlCommand(target, ['apply', '--filename=-']),
    buildImageVolumeProbePod(podName, nodeName),
  );
  if (result.exitCode !== 0) {
    throw runtimeFailure(`Could not create the ImageVolume canary Pod on node "${nodeName}"`, result);
  }
}

async function waitForImageVolumeCanary(
  target: KubernetesImageVolumeCapabilityTarget,
  podName: string,
  nodeName: string,
): Promise<void> {
  const result: CommandResult = await runCommandWithTimeout(
    buildProbeKubectlCommand(target, [
      'wait',
      `pod/${podName}`,
      '--for=condition=Ready',
      `--timeout=${canaryKubernetesTimeout}`,
    ]),
    canaryTimeoutMs,
  );
  if (result.exitCode !== 0) {
    throw runtimeFailure(`The ImageVolume canary Pod did not become Ready on node "${nodeName}"`, result);
  }
}

async function assertImageVolumeCanaryMount(
  target: KubernetesImageVolumeCapabilityTarget,
  podName: string,
  nodeName: string,
): Promise<void> {
  const result: CommandResult = await runCommandWithTimeout(
    buildProbeKubectlCommand(target, ['exec', `pod/${podName}`, '--', 'test', '-f', '/image/etc/os-release']),
    30_000,
  );
  if (result.exitCode !== 0) {
    throw runtimeFailure(`The ImageVolume canary mount is unavailable on node "${nodeName}"`, result);
  }
}

async function deleteImageVolumeCanary(
  target: KubernetesImageVolumeCapabilityTarget,
  podName: string,
  primaryFailure: Error | null,
): Promise<void> {
  const result: CommandResult = await runCommandWithTimeout(
    buildProbeKubectlCommand(target, ['delete', `pod/${podName}`, '--ignore-not-found', '--wait=true', '--timeout=2m']),
    150_000,
  );
  if (result.exitCode === 0) {
    return;
  }
  const cleanupFailure: string = formatKubernetesCommandFailure('ImageVolume canary cleanup failed', result);
  if (primaryFailure !== null) {
    primaryFailure.message = `${primaryFailure.message}\n${cleanupFailure}`;
    return;
  }
  throw new Error(cleanupFailure);
}

function runtimeFailure(message: string, result: CommandResult): Error {
  return new Error(
    `${formatKubernetesCommandFailure(message, result)}\nEnable ImageVolume=true on every current and autoscaler-created eligible kubelet before installing or updating Compartment.`,
  );
}

function buildImageVolumeProbePod(podName: string = 'compartment-image-volume-preflight', nodeName?: string): string {
  return JSON.stringify({
    apiVersion: 'v1',
    kind: 'Pod',
    metadata: { name: podName, namespace: 'default' },
    spec: {
      automountServiceAccountToken: false,
      containers: [
        {
          args: ['sleep 300'],
          command: ['sh', '-c'],
          image: probeImage,
          name: 'probe',
          securityContext: { allowPrivilegeEscalation: false, capabilities: { drop: ['ALL'] } },
          volumeMounts: [{ mountPath: '/image', name: imageVolumeName, readOnly: true }],
        },
      ],
      ...(nodeName === undefined ? {} : { nodeName, tolerations: [{ operator: 'Exists' }] }),
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

function buildProbeKubectlCommand(target: KubernetesImageVolumeCapabilityTarget, args: readonly string[]): string[] {
  return buildKubectlCommand({ ...target, namespace: 'default' }, args);
}

function readJson(value: string): JsonValue {
  try {
    return JSON.parse(value) as JsonValue;
  } catch {
    return null;
  }
}
