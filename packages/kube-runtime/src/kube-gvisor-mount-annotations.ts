import type { KubeJobSpec } from './kube-job-spec.types';

export function gvisorTmpfsAnnotations(spec: KubeJobSpec): Record<string, string> {
  const annotations: Record<string, string> = {};
  for (const volume of spec.emptyDirVolumes ?? []) {
    if (volume.gvisorTmpfs !== true) {
      continue;
    }
    const prefix: string = `dev.gvisor.spec.mount.${volume.name}`;
    if (volume.sizeLimit === undefined) {
      throw new Error(`gVisor tmpfs volume ${volume.name} requires a sizeLimit.`);
    }
    annotations[`${prefix}.options`] = `rw,rprivate,size=${normalizeGvisorTmpfsSizeLimit(volume.sizeLimit)}`;
    annotations[`${prefix}.share`] = 'container';
    annotations[`${prefix}.type`] = 'tmpfs';
  }
  return annotations;
}

export function normalizeGvisorTmpfsSizeLimit(sizeLimit: string): string {
  const match: RegExpExecArray | null = /^(?<amount>[1-9][0-9]{0,3})(?<unit>Mi|Gi|Ti)$/u.exec(sizeLimit);
  const amount: number = Number(match?.groups?.amount);
  if (match?.groups === undefined || amount > 8191) {
    throw new Error(`gVisor tmpfs sizeLimit must be 1-8191 whole Mi, Gi, or Ti: ${sizeLimit}.`);
  }
  const unit: string = match.groups.unit ?? '';
  return `${amount.toString()}${unit.charAt(0).toLowerCase()}`;
}
