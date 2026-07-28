import type { DomainIssuerReference } from '@compartment/contracts';

export interface CustomDomainProjectionRow {
  caddyServiceName: string;
  domainId: string;
  host: string;
  ingressClassName: string;
  issuerRef: DomainIssuerReference;
  namespace: string;
}

export interface KubeCertificateCondition {
  status?: string | undefined;
  type?: string | undefined;
}

export interface KubeCertificateStatus {
  conditions?: KubeCertificateCondition[] | undefined;
  observedGeneration?: number | undefined;
}

export interface CustomDomainProjectionObservation {
  certificatePresent: boolean;
  certificateReady: boolean;
  ingressPresent: boolean;
}
