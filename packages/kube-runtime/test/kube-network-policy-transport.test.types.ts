export interface SerializedIngressRule {
  from?: object[] | undefined;
  ports?: object[] | undefined;
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
