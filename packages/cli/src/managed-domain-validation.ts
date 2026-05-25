import { hasText } from '@compartment/utils';
import type { ManagedDomainInstallState } from './managed-domain.types';

export function assertManagedDomainTlsMetadata(managedDomain: ManagedDomainInstallState): void {
  assertManagedDomainText(managedDomain.acmeEmail, 'acmeEmail');
}

function assertManagedDomainText(value: string | undefined, fieldName: string): void {
  if (hasText(value)) {
    return;
  }

  throw new Error(`Managed domain reset requires ${fieldName} in install state.`);
}
