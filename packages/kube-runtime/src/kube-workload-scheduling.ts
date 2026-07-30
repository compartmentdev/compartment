import type { KubeDeploymentManifest, KubeManifest, KubeProjectedPodSpec } from './kube-runtime.types';
import type { KubeWorkloadScheduling } from './kube-workload-scheduling.types';

export const tenantPriorityClassName: string = 'compartment-tenant';

export function projectTenantScheduling(
  scheduling: KubeWorkloadScheduling | undefined,
): Pick<KubeProjectedPodSpec, 'nodeSelector' | 'priorityClassName' | 'runtimeClassName' | 'tolerations'> {
  if (scheduling === undefined) {
    return {};
  }
  return {
    ...(Object.keys(scheduling.nodeSelector).length === 0 ? {} : { nodeSelector: scheduling.nodeSelector }),
    priorityClassName: tenantPriorityClassName,
    ...(scheduling.runtimeClassName === undefined ? {} : { runtimeClassName: scheduling.runtimeClassName }),
    ...(scheduling.tolerations.length === 0 ? {} : { tolerations: scheduling.tolerations }),
  };
}

export function projectWorkloadScheduling(manifests: KubeManifest[], desired: KubeManifest[]): KubeManifest[] {
  const desiredDeployment: KubeDeploymentManifest | undefined = desired.find(
    (manifest: KubeManifest): manifest is KubeDeploymentManifest => manifest.kind === 'Deployment',
  );
  if (desiredDeployment?.spec === undefined) {
    return manifests;
  }
  const desiredPodSpec: KubeProjectedPodSpec = desiredDeployment.spec.template.spec;
  return manifests.map((manifest: KubeManifest): KubeManifest => projectManifestScheduling(manifest, desiredPodSpec));
}

function projectManifestScheduling(manifest: KubeManifest, desiredPodSpec: KubeProjectedPodSpec): KubeManifest {
  if (manifest.kind !== 'Deployment' || manifest.spec === undefined) {
    return manifest;
  }
  return {
    ...manifest,
    spec: {
      ...manifest.spec,
      template: {
        ...manifest.spec.template,
        spec: {
          ...withoutScheduling(manifest.spec.template.spec),
          ...(desiredPodSpec.nodeSelector === undefined ? {} : { nodeSelector: desiredPodSpec.nodeSelector }),
          ...(desiredPodSpec.priorityClassName === undefined
            ? {}
            : { priorityClassName: desiredPodSpec.priorityClassName }),
          ...(desiredPodSpec.runtimeClassName === undefined
            ? {}
            : { runtimeClassName: desiredPodSpec.runtimeClassName }),
          ...(desiredPodSpec.tolerations === undefined ? {} : { tolerations: desiredPodSpec.tolerations }),
        },
      },
    },
  };
}

function withoutScheduling(spec: KubeProjectedPodSpec): KubeProjectedPodSpec {
  const result: KubeProjectedPodSpec = { ...spec };
  delete result.nodeSelector;
  delete result.priorityClassName;
  delete result.runtimeClassName;
  delete result.tolerations;
  return result;
}
