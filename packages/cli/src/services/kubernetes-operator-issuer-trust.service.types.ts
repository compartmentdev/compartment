export interface KubernetesCertManagerIssuer {
  spec?: KubernetesCertManagerIssuerSpec | undefined;
}

export interface KubernetesCertManagerIssuerSpec {
  acme?: Record<string, string> | undefined;
  ca?: Record<string, string> | undefined;
  selfSigned?: Record<string, string> | undefined;
}

type KubernetesOperatorIssuerTrust = 'acme' | 'ca' | 'unknown' | 'unreadable';

export interface KubernetesOperatorIssuerAssessment {
  detail: string;
  trust: KubernetesOperatorIssuerTrust;
}
