import { compareKubeKey } from './kube-key-order';
import type { KubeResourceReachabilityProbe } from './kube-resource-reachability-projection.types';
import type {
  KubeLiteralEnvVariable,
  KubeObservedManifest,
  KubeProjectedInitContainer,
  KubeProjectedSidecarContainer,
} from './kube-runtime.types';
import { platformContainerSecurityContext } from './kube-security-context';

const resourceReachabilityContainerName: string = 'await-resources';

/**
 * Projects the container that holds a tenant Pod pre-Running until every resource it dials accepts a connection.
 *
 * It has to be a container in the Pod rather than a control-plane wait: on the supported CNI a new Pod's address
 * only joins the policy peer set on a later controller sync, so the first packet from a fresh Pod can be refused
 * even though the resource is serving. Proving reachability therefore has to happen from the Pod's own address,
 * and it has to happen for every Pod, including scale-ups and reschedules no controller observes.
 *
 * `FallbackToLogsOnError` makes the failing endpoint readable from the Pod's own status when the probe gives up
 * without writing a termination message.
 */
export function projectResourceReachabilityInitContainer(
  probe: KubeResourceReachabilityProbe,
): KubeProjectedInitContainer {
  return {
    command: probe.command,
    env: literalEnvironment(probe.env),
    image: probe.image,
    name: resourceReachabilityContainerName,
    securityContext: platformContainerSecurityContext(),
    terminationMessagePolicy: 'FallbackToLogsOnError',
  };
}

/**
 * The probe a live Job already carries. A Job's Pod template is immutable, so finalization must re-apply what the
 * object has rather than what a fresh claim would resolve: resources change between creation and recovery, and the
 * manifest cannot.
 */
export function observedResourceReachabilityProbe(
  observed: KubeObservedManifest,
): KubeResourceReachabilityProbe | undefined {
  if (observed.kind !== 'Job') {
    return undefined;
  }
  const container: KubeProjectedInitContainer | KubeProjectedSidecarContainer | undefined =
    observed.spec?.template.spec.initContainers?.find(
      (candidate: KubeProjectedInitContainer | KubeProjectedSidecarContainer): boolean =>
        candidate.name === resourceReachabilityContainerName,
    );
  if (container === undefined) {
    return undefined;
  }
  return {
    command: container.command ?? [],
    env: Object.fromEntries(
      container.env.map((variable: KubeLiteralEnvVariable): [string, string] => [variable.name, variable.value]),
    ),
    image: container.image,
  };
}

function literalEnvironment(env: Readonly<Record<string, string>>): KubeLiteralEnvVariable[] {
  return Object.keys(env)
    .sort(compareKubeKey)
    .map((name: string): KubeLiteralEnvVariable => ({ name, value: env[name] ?? '' }));
}
