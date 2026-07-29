import type { DomainTlsMode } from '@compartment/contracts';
import type { KubernetesInstallTlsMode } from './kubernetes-install.service.types';

export function mapDomainTlsModeToPlatformTlsMode(tlsMode: DomainTlsMode): KubernetesInstallTlsMode {
  switch (tlsMode) {
    case 'broker-dns01':
      return 'broker-dns01';
    case 'external':
      return 'issuer';
    case 'internal':
      return 'internal';
  }
}
