import type { JsonValue } from '@compartment/utils';

export interface KubernetesCertManagerIssuer {
  spec?: KubernetesCertManagerIssuerSpec | undefined;
  status?: KubernetesCertManagerIssuerStatus | undefined;
}

export interface KubernetesCertManagerIssuerSpec {
  acme?: KubernetesCertManagerAcmeIssuer | undefined;
  ca?: Record<string, string> | undefined;
  selfSigned?: Record<string, string> | undefined;
}

export interface KubernetesCertManagerAcmeIssuer {
  server?: string | undefined;
  solvers?: KubernetesCertManagerAcmeSolver[] | undefined;
}

export interface KubernetesCertManagerAcmeSolver {
  dns01?: Record<string, JsonValue> | undefined;
  http01?: Record<string, JsonValue> | undefined;
}

export interface KubernetesCertManagerIssuerStatus {
  conditions?: KubernetesCertManagerIssuerCondition[] | undefined;
}

export interface KubernetesCertManagerIssuerCondition {
  status?: string | undefined;
  type?: string | undefined;
}

type KubernetesOperatorIssuerTrust = 'acme' | 'ca' | 'unknown' | 'unreadable';

export interface KubernetesOperatorIssuerAssessment {
  detail: string;
  dns01?: boolean | undefined;
  ready?: boolean | undefined;
  trust: KubernetesOperatorIssuerTrust;
}
