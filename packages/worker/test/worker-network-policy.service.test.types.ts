import type { KubeRuntime } from '@compartment/kube-runtime';
import type { Mock } from 'vitest';

export interface NetworkPolicyRule {
  /** Manifests carry ingress peers under the client-node model property `_from`, which serializes to wire `from`. */
  _from?: NetworkPolicyPeer[] | undefined;
  ports?: NetworkPolicyRulePort[] | undefined;
}

export interface NetworkPolicyPeer {
  namespaceSelector?: NetworkPolicySelector | undefined;
  podSelector?: NetworkPolicySelector | undefined;
}

export interface NetworkPolicySelector {
  matchLabels?: Record<string, string> | undefined;
}

export interface NetworkPolicyRulePort {
  port: number;
}

export interface NetworkPolicySpec {
  egress?: NetworkPolicyRule[] | undefined;
  ingress?: NetworkPolicyRule[] | undefined;
}

export interface ApplicationDeploymentContainer {
  ports: ApplicationDeploymentContainerPort[];
}

export interface ApplicationDeploymentContainerPort {
  containerPort: number;
  name: string;
}

export interface ApplicationDeploymentPodSpec {
  containers: ApplicationDeploymentContainer[];
}

export interface ApplicationDeploymentTemplate {
  spec: ApplicationDeploymentPodSpec;
}

export interface ApplicationDeploymentSpec {
  template: ApplicationDeploymentTemplate;
}

export interface ApplicationServicePort {
  name: string;
  targetPort: number;
}

export interface ApplicationServiceSpec {
  ports: ApplicationServicePort[];
}

export interface IdentityApplyRuntime {
  apply: Mock;
  runtime: KubeRuntime;
}
