import type {
  KubeDeploymentManifest,
  KubeManifest,
  KubeObservation,
  KubeObservedManifest,
} from '@compartment/kube-runtime';
import type { CompartmentRequester } from '@compartment/sdk';
import { vi } from 'vitest';
import type { AppliedGateContainer, ApplyReadRuntime } from './worker-deployment-reconcile.service.test.types';

export function kubeObservation(pods: KubeObservedManifest[]): KubeObservation {
  return {
    cache: new Map(
      pods.map((pod: KubeObservedManifest, index: number): [string, KubeObservedManifest] => [
        `pods/cpt-prj/${index.toString()}`,
        pod,
      ]),
    ),
    stop: vi.fn(async (): Promise<void> => await Promise.resolve()),
  } as never;
}

export function requester(): CompartmentRequester {
  return async function unexpectedRequest<TResult>(): Promise<TResult> {
    await Promise.resolve();
    throw new Error('Unexpected direct request.');
  };
}

/** The reachability gate on the Deployment this reconcile applied, if it projected one. */
export function appliedGate(runtime: ApplyReadRuntime): AppliedGateContainer | undefined {
  const bundle = runtime.apply.mock.calls.at(-1)?.[0] as { objects: KubeManifest[] };
  const deployment: KubeDeploymentManifest | undefined = bundle.objects.find(
    (object: KubeManifest): object is KubeDeploymentManifest => object.kind === 'Deployment',
  );
  return deployment?.spec?.template.spec.initContainers?.[0];
}
