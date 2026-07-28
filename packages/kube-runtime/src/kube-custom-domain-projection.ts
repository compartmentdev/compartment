import type { V1ObjectMeta } from '@kubernetes/client-node';
import type {
  CustomDomainProjectionObservation,
  CustomDomainProjectionRow,
  KubeCertificateCondition,
  KubeCertificateStatus,
} from './kube-custom-domain-projection.types';
import { kubeCustomDomainName, kubeCustomDomainTlsSecretName } from './kube-naming';
import type { KubeManifest, KubeObservedManifest } from './kube-runtime.types';

const managedLabels: Readonly<Record<string, string>> = {
  'app.kubernetes.io/component': 'custom-domain',
  'app.kubernetes.io/managed-by': 'compartment',
};

type ProjectionValue = boolean | number | ProjectionObject | ProjectionValue[] | string | null;

interface ProjectionObject {
  [key: string]: ProjectionValue | undefined;
}

export function projectCustomDomainManifests(row: CustomDomainProjectionRow): KubeManifest[] {
  const metadata: V1ObjectMeta = {
    labels: { ...managedLabels, 'compartment.dev/custom-domain-id': row.domainId },
    name: kubeCustomDomainName(row.domainId),
    namespace: row.namespace,
  };
  const secretName: string = kubeCustomDomainTlsSecretName(row.domainId);
  return [ingressManifest(row, metadata, secretName), certificateManifest(row, metadata, secretName)];
}

function ingressManifest(row: CustomDomainProjectionRow, metadata: V1ObjectMeta, secretName: string): KubeManifest {
  return {
    apiVersion: 'networking.k8s.io/v1',
    kind: 'Ingress',
    metadata,
    spec: {
      ingressClassName: row.ingressClassName,
      rules: [
        {
          host: row.host,
          http: {
            paths: [
              {
                backend: { service: { name: row.caddyServiceName, port: { name: 'http' } } },
                path: '/',
                pathType: 'Prefix',
              },
            ],
          },
        },
      ],
      tls: [{ hosts: [row.host], secretName }],
    },
  };
}

function certificateManifest(row: CustomDomainProjectionRow, metadata: V1ObjectMeta, secretName: string): KubeManifest {
  return {
    apiVersion: 'cert-manager.io/v1',
    kind: 'Certificate',
    metadata,
    spec: {
      dnsNames: [row.host],
      issuerRef: row.issuerRef,
      secretName,
    },
  };
}

export function observeCustomDomainProjection(
  manifests: KubeManifest[],
  ingress: KubeObservedManifest | null,
  certificate: KubeObservedManifest | null,
): CustomDomainProjectionObservation {
  const ingressPresent: boolean = matchesProjectedManifest(manifests[0], ingress);
  const certificatePresent: boolean = matchesProjectedManifest(manifests[1], certificate);
  return {
    certificatePresent,
    certificateReady: certificatePresent && isCurrentKubeCertificateReady(certificate),
    ingressPresent,
  };
}

function matchesProjectedManifest(projected: KubeManifest | undefined, observed: KubeObservedManifest | null): boolean {
  return (
    projected !== undefined &&
    observed !== null &&
    projected.apiVersion === observed.apiVersion &&
    projected.kind === observed.kind &&
    projected.metadata?.name === observed.metadata?.name &&
    projected.metadata?.namespace === observed.metadata?.namespace &&
    containsProjectedValue(projected.spec, observed.spec)
  );
}

function containsProjectedValue(projected: object | undefined, observed: object | undefined): boolean {
  if (projected === undefined) {
    return true;
  }
  if (observed === undefined) {
    return false;
  }
  return matchesProjectedValue(projected as ProjectionObject, observed as ProjectionObject);
}

function matchesProjectedValue(projected: ProjectionValue | undefined, observed: ProjectionValue | undefined): boolean {
  if (Array.isArray(projected)) {
    return (
      Array.isArray(observed) &&
      projected.length === observed.length &&
      projected.every((value: ProjectionValue, index: number): boolean => matchesProjectedValue(value, observed[index]))
    );
  }
  if (projected !== null && typeof projected === 'object') {
    return (
      observed !== null &&
      !Array.isArray(observed) &&
      typeof observed === 'object' &&
      Object.entries(projected).every(([key, value]: [string, ProjectionValue | undefined]): boolean =>
        matchesProjectedValue(value, observed[key]),
      )
    );
  }
  return projected === observed;
}

function isCurrentKubeCertificateReady(certificate: KubeObservedManifest | null): boolean {
  if (certificate?.kind !== 'Certificate' || certificate.metadata?.generation === undefined) {
    return false;
  }
  const status: KubeCertificateStatus | undefined = certificate.status;
  return (
    status?.observedGeneration === certificate.metadata.generation &&
    (status.conditions ?? []).some(
      (condition: KubeCertificateCondition): boolean => condition.type === 'Ready' && condition.status === 'True',
    )
  );
}
