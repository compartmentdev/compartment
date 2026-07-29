import { kubeJobIdentity, kubeJobManifest, kubeJobSecretManifest } from './kube-job-projection';
import { readHttpStatusCode } from './kube-runtime-operations';
import type { ApplyBundle, KubeJobSpec, KubeManifest, KubeObservedManifest } from './kube-runtime.types';

interface KubeJobRuntimeAccess {
  apply(bundle: ApplyBundle): Promise<KubeManifest[]>;
  read(object: KubeManifest): Promise<KubeObservedManifest | null>;
}

export async function createOrJoinKubeJob(
  runtime: KubeJobRuntimeAccess,
  spec: KubeJobSpec,
  jobName: string,
  labels: Record<string, string>,
  observed: KubeObservedManifest | null,
): Promise<KubeObservedManifest | null> {
  if (observed !== null) {
    return observed;
  }
  try {
    await runtime.apply({ objects: [kubeJobSecretManifest(spec, labels), kubeJobManifest(spec, jobName, labels)] });
    return null;
  } catch (error) {
    if (!(error instanceof Error && readHttpStatusCode(error) === 409)) {
      throw error;
    }
    return await runtime.read(kubeJobIdentity(spec, jobName));
  }
}
