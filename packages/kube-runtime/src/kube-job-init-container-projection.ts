import type {
  KubeJobInitializer,
  KubeJobSidecar,
  KubeJobSpec,
  KubeLiteralEnvVariable,
  KubeProjectedInitializerContainer,
  KubeProjectedPodSpec,
  KubeProjectedSidecarContainer,
} from './kube-runtime.types';
import { restrictedContainerSecurityContext, userNamespaceBuildKitSecurityContext } from './kube-security-context';
import { compareKubeKey } from './kube-key-order';

export function projectJobInitContainers(spec: KubeJobSpec): Pick<KubeProjectedPodSpec, 'initContainers'> {
  if (spec.sidecars === undefined && spec.initializers === undefined) {
    return {};
  }
  return {
    initContainers: [
      ...(spec.initializers?.map(projectInitializer) ?? []),
      ...(spec.sidecars?.map(projectSidecar) ?? []),
    ],
  };
}

function projectInitializer(initializer: KubeJobInitializer): KubeProjectedInitializerContainer {
  return {
    args: initializer.args,
    command: initializer.command,
    image: initializer.image,
    name: initializer.name,
    securityContext: restrictedContainerSecurityContext(),
    volumeMounts: initializer.volumeMounts,
  };
}

function projectSidecar(sidecar: KubeJobSidecar): KubeProjectedSidecarContainer {
  const env: KubeLiteralEnvVariable[] = Object.entries(sidecar.env)
    .sort(([leftName]: [string, string], [rightName]: [string, string]): number => compareKubeKey(leftName, rightName))
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
    securityContext: userNamespaceBuildKitSecurityContext(),
    volumeMounts: sidecar.volumeMounts,
  };
}
