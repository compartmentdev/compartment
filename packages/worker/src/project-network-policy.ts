import type { ProjectNetworkPolicyPorts } from '@compartment/contracts';
import type { ProjectNetworkPolicyProjection } from '@compartment/kube-runtime';
import { z } from 'zod';

export interface ProjectNetworkPolicyEnvironment {
  COMPARTMENT_EDGE_NAMESPACE: string;
  COMPARTMENT_EDGE_POD_LABELS: string;
  COMPARTMENT_KUBE_POD_CIDR: string;
  COMPARTMENT_KUBE_SERVICE_CIDR: string;
}

export type EdgePodLabels = Readonly<Record<string, string>>;

/**
 * The chart renders `COMPARTMENT_EDGE_POD_LABELS` as JSON from the same template that labels the Caddy Pods, so
 * the ingress peer selects the Pods this installation actually runs instead of a literal restated here.
 * A missing or unparsable value must fail: an empty selector in a peer admits every Pod of the edge namespace
 * into tenant applications, which is the hole this policy exists to close.
 */
const edgePodLabelsSchema: z.ZodType<EdgePodLabels> = z
  .record(z.string().min(1), z.string().min(1))
  .refine((labels: Record<string, string>): boolean => Object.keys(labels).length > 0);

export function projectNetworkPolicy(
  environment: ProjectNetworkPolicyEnvironment,
  ports: ProjectNetworkPolicyPorts,
): ProjectNetworkPolicyProjection {
  return {
    applicationPodLabels: { app: 'application' },
    applicationPorts: ports.applicationPorts,
    edgeNamespaceName: environment.COMPARTMENT_EDGE_NAMESPACE,
    // Caddy proxies to tenant Services. Edge only answers forward_auth subrequests and never dials tenant Pods.
    edgePodLabels: readEdgePodLabels(environment.COMPARTMENT_EDGE_POD_LABELS),
    podCidr: environment.COMPARTMENT_KUBE_POD_CIDR,
    resourcePodLabels: { app: 'resource' },
    resourcePorts: ports.resourcePorts,
    serviceCidr: environment.COMPARTMENT_KUBE_SERVICE_CIDR,
  };
}

export function readEdgePodLabels(value: string): EdgePodLabels {
  try {
    return edgePodLabelsSchema.parse(JSON.parse(value));
  } catch {
    throw new Error('COMPARTMENT_EDGE_POD_LABELS must be a JSON object declaring at least one Caddy Pod label.');
  }
}
