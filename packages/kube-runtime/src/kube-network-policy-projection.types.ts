export interface ProjectNetworkPolicyProjection {
  applicationPodLabels: Readonly<Record<string, string>>;
  applicationPorts: number[];
  edgeNamespaceName: string;
  edgePodLabels: Readonly<Record<string, string>>;
  podCidr: string;
  resourcePodLabels: Readonly<Record<string, string>>;
  resourcePorts: number[];
  serviceCidr: string;
}

export interface KubeNetworkPolicySelectorRequirement {
  key: string;
  operator: 'Exists';
}

export interface KubeNetworkPolicySelector {
  matchExpressions?: KubeNetworkPolicySelectorRequirement[] | undefined;
  matchLabels?: Readonly<Record<string, string>> | undefined;
}

export interface KubeNetworkPolicyIpBlock {
  cidr: string;
  except: string[];
}

export interface KubeNetworkPolicyPeer {
  ipBlock?: KubeNetworkPolicyIpBlock | undefined;
  namespaceSelector?: KubeNetworkPolicySelector | undefined;
  podSelector?: KubeNetworkPolicySelector | undefined;
}

export interface KubeNetworkPolicyPort {
  port: number;
  protocol: 'TCP' | 'UDP';
}

/**
 * `_from` carries the ingress peers. `@kubernetes/client-node` generates `V1NetworkPolicyIngressRule` with the model
 * property `_from` mapped to the wire field `from`, and its `ObjectSerializer` reads manifests by model property name.
 * A rule written as `from` is therefore absent from the request body and reaches the API server as an unrestricted
 * ingress rule. `KubeLimitRangeItem._default` exists for the same reason.
 */
export interface KubeNetworkPolicyIngressRule {
  _from: KubeNetworkPolicyPeer[];
  ports: KubeNetworkPolicyPort[];
}

export interface KubeNetworkPolicyEgressRule {
  ports?: KubeNetworkPolicyPort[] | undefined;
  to: KubeNetworkPolicyPeer[];
}

export interface KubeNetworkPolicySpec {
  egress?: KubeNetworkPolicyEgressRule[] | undefined;
  ingress?: KubeNetworkPolicyIngressRule[] | undefined;
  podSelector: KubeNetworkPolicySelector;
  policyTypes: ('Egress' | 'Ingress')[];
}
