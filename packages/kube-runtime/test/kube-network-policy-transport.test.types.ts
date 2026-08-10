export interface SerializedSelectorRequirement {
  key: string;
  operator: string;
}

export interface SerializedSelector {
  matchExpressions?: SerializedSelectorRequirement[] | undefined;
  matchLabels?: Record<string, string> | undefined;
}

export interface SerializedPeer {
  namespaceSelector?: SerializedSelector | undefined;
  podSelector?: SerializedSelector | undefined;
}

export interface SerializedPort {
  port: number;
  protocol: string;
}

export interface SerializedIngressRule {
  from?: SerializedPeer[] | undefined;
  ports?: SerializedPort[] | undefined;
}

export interface SerializedNetworkPolicyMetadata {
  name: string;
}

export interface SerializedNetworkPolicySpec {
  ingress?: SerializedIngressRule[] | undefined;
}

export interface SerializedNetworkPolicy {
  metadata: SerializedNetworkPolicyMetadata;
  spec: SerializedNetworkPolicySpec;
}
