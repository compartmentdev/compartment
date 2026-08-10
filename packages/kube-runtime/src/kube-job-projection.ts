import type {
  KubeJobManifest,
  KubeJobManifestSpec,
  KubeJobSpec,
  KubeJobSidecar,
  KubeLiteralEnvVariable,
  KubeManifest,
  KubeObservedManifest,
  KubeProjectedContainer,
  KubeProjectedInitContainer,
  KubeProjectedSidecarContainer,
  KubeProjectedPodSpec,
  KubeSecretEnvVariable,
} from './kube-runtime.types';
import { compareKubeKey } from './kube-key-order';
import { gvisorTmpfsAnnotations } from './kube-gvisor-mount-annotations';
import { kubeJobVolumeMounts, kubeJobVolumes } from './kube-job-volume-projection';
import { kubeSecretName } from './kube-naming';
import {
  observedResourceReachabilityProbe,
  projectResourceReachabilityInitContainer,
} from './kube-resource-reachability-projection';
import { secretChecksum } from './kube-secret-projection';
import type { KubeContainerSecurityContext, KubePodSecurityContext } from './kube-security-context.types';
import {
  assertGvisorBuildKitSidecars,
  gvisorBuildKitSecurityContext,
  gvisorBuildRunnerSecurityContext,
  projectPodSecurityContext,
  projectVolumeSecurityContext,
  resourcePodSecurityContext,
  restrictedContainerSecurityContext,
} from './kube-security-context';
import { projectTenantScheduling, tenantPriorityClassName } from './kube-workload-scheduling';

export function kubeFinalizedJobManifest(
  spec: KubeJobSpec,
  jobName: string,
  labels: Record<string, string>,
): KubeJobManifest {
  const manifest: KubeJobManifest = kubeJobManifest(spec, jobName, labels);
  return { ...manifest, spec: { ...jobSpec(spec, labels), ttlSecondsAfterFinished: 300 } };
}

export function kubeJobManifest(spec: KubeJobSpec, jobName: string, labels: Record<string, string>): KubeJobManifest {
  return {
    apiVersion: 'batch/v1',
    kind: 'Job',
    metadata: { labels, name: jobName, namespace: spec.namespace },
    spec: jobSpec(spec, labels),
  };
}

export function kubeJobIdentity(spec: KubeJobSpec, jobName: string): KubeJobManifest {
  return { apiVersion: 'batch/v1', kind: 'Job', metadata: { name: jobName, namespace: spec.namespace } };
}

export function kubeJobSecretManifest(spec: KubeJobSpec, labels: Record<string, string>): KubeManifest {
  return {
    apiVersion: 'v1',
    kind: 'Secret',
    metadata: { labels, name: kubeSecretName(spec.id), namespace: spec.namespace },
    stringData: spec.env,
    type: 'Opaque',
  };
}

export function recoveredJobSpec(spec: KubeJobSpec, observed: KubeObservedManifest | null): KubeJobSpec {
  if (observed === null) {
    return spec;
  }
  const finalizationSpec: KubeJobSpec = { ...spec, resourceProbe: observedResourceReachabilityProbe(observed) };
  delete finalizationSpec.scheduling;
  if (observed.kind !== 'Job' || observed.spec?.template.spec.priorityClassName !== tenantPriorityClassName) {
    return finalizationSpec;
  }
  return {
    ...finalizationSpec,
    scheduling: {
      nodeSelector: observed.spec.template.spec.nodeSelector ?? {},
      ...(observed.spec.template.spec.runtimeClassName === undefined
        ? {}
        : { runtimeClassName: observed.spec.template.spec.runtimeClassName }),
      tolerations: observed.spec.template.spec.tolerations ?? [],
    },
  };
}

function jobSpec(spec: KubeJobSpec, labels: Record<string, string>): KubeJobManifestSpec {
  assertGvisorBuildKitSidecars(spec);
  const initContainers: (KubeProjectedInitContainer | KubeProjectedSidecarContainer)[] = jobInitContainers(spec);
  const podSpec: KubeProjectedPodSpec = {
    automountServiceAccountToken: false,
    containers: [jobContainer(spec)],
    imagePullSecrets:
      spec.imagePullSecretId === undefined ? undefined : [{ name: kubeSecretName(spec.imagePullSecretId) }],
    ...(initContainers.length === 0 ? {} : { initContainers }),
    ...projectTenantScheduling(spec.scheduling),
    restartPolicy: 'Never',
    securityContext: jobPodSecurityContext(spec),
    serviceAccountName: spec.serviceAccountName,
    volumes: kubeJobVolumes(spec),
  };
  return {
    activeDeadlineSeconds: Math.max(1, Math.ceil(spec.timeoutMs / 1_000)),
    backoffLimit: spec.jobClass === 'release' ? 0 : 1,
    template: {
      metadata: { annotations: jobPodAnnotations(spec), labels },
      spec: podSpec,
    },
  };
}

/**
 * The reachability probe runs before the BuildKit sidecar starts, which costs nothing: build Jobs dial no
 * resource and never carry a probe.
 */
function jobInitContainers(spec: KubeJobSpec): (KubeProjectedInitContainer | KubeProjectedSidecarContainer)[] {
  return [
    ...(spec.resourceProbe === undefined ? [] : [projectResourceReachabilityInitContainer(spec.resourceProbe)]),
    ...(spec.sidecars ?? []).map(projectSidecar),
  ];
}

function jobPodAnnotations(spec: KubeJobSpec): Record<string, string> {
  return { 'compartment.dev/secret-checksum': secretChecksum(spec.env), ...gvisorTmpfsAnnotations(spec) };
}

function jobPodSecurityContext(spec: KubeJobSpec): KubePodSecurityContext | undefined {
  if (spec.sidecars !== undefined && spec.sidecars.length > 0) {
    return { seccompProfile: { type: 'RuntimeDefault' } };
  }
  const volumeGroupContext: KubePodSecurityContext =
    spec.volumeMounts === undefined || spec.volumeMounts.length === 0 ? {} : projectVolumeSecurityContext();
  if (spec.securityProfile === 'restricted') {
    return { ...volumeGroupContext, ...projectPodSecurityContext() };
  }
  if (spec.securityProfile === 'project-restricted') {
    return { ...volumeGroupContext, ...projectPodSecurityContext() };
  }
  if (spec.securityProfile === 'resource-restricted') {
    return { ...resourcePodSecurityContext(spec.image), ...volumeGroupContext };
  }
  return Object.keys(volumeGroupContext).length === 0 ? undefined : volumeGroupContext;
}

function projectSidecar(sidecar: KubeJobSidecar): KubeProjectedSidecarContainer {
  const env: KubeLiteralEnvVariable[] = Object.entries(sidecar.env)
    .sort(([leftName]: [string, string], [rightName]: [string, string]): number => leftName.localeCompare(rightName))
    .map(
      ([name, value]: [string, string]): KubeLiteralEnvVariable => ({
        name,
        value,
      }),
    );
  return {
    args: sidecar.args,
    command: sidecar.command,
    env,
    image: sidecar.image,
    name: sidecar.name,
    resources: sidecar.resources,
    restartPolicy: 'Always',
    securityContext: gvisorBuildKitSecurityContext(),
    volumeMounts: sidecar.volumeMounts,
  };
}

function jobContainer(spec: KubeJobSpec): KubeProjectedContainer {
  const env: KubeSecretEnvVariable[] = Object.keys(spec.env)
    .sort(compareKubeKey)
    .map(
      (name: string): KubeSecretEnvVariable => ({
        name,
        valueFrom: { secretKeyRef: { key: name, name: kubeSecretName(spec.id) } },
      }),
    );
  return {
    args: spec.args,
    command: spec.command,
    env,
    image: spec.image,
    name: 'job',
    resources: spec.resources,
    securityContext: jobContainerSecurityContext(spec),
    volumeMounts: kubeJobVolumeMounts(spec),
  };
}

function jobContainerSecurityContext(spec: KubeJobSpec): KubeContainerSecurityContext | undefined {
  if (spec.sidecars !== undefined && spec.sidecars.length > 0) {
    return gvisorBuildRunnerSecurityContext();
  }
  if (
    spec.securityProfile === 'restricted' ||
    spec.securityProfile === 'project-restricted' ||
    spec.securityProfile === 'resource-restricted'
  ) {
    return restrictedContainerSecurityContext();
  }
  return undefined;
}
