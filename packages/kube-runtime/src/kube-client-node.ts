import {
  makeInformer,
  type Informer,
  type KubeConfig,
  type KubernetesListObject,
  type KubernetesObject,
} from '@kubernetes/client-node';

type KubeListPromise = () => Promise<KubernetesListObject<KubernetesObject>>;

export function createKubeInformer(
  kubeConfig: KubeConfig,
  path: string,
  list: KubeListPromise,
  selector: string,
): Informer<KubernetesObject> {
  if (selector.length === 0) {
    throw new Error('Kubernetes informer requires an ownership selector.');
  }
  return makeInformer(kubeConfig, path, list, selector);
}
