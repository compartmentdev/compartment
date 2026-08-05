import type { KubeJobSpec } from './kube-job-spec.types';

export function gvisorTmpfsAnnotations(spec: KubeJobSpec): Record<string, string> {
  const annotations: Record<string, string> = {};
  for (const volume of spec.emptyDirVolumes ?? []) {
    if (volume.gvisorTmpfs !== true) {
      continue;
    }
    const prefix: string = `dev.gvisor.spec.mount.${volume.name}`;
    annotations[`${prefix}.options`] = 'rw,rprivate';
    annotations[`${prefix}.share`] = 'container';
    annotations[`${prefix}.type`] = 'tmpfs';
  }
  return annotations;
}
