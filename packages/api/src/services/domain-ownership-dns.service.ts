const ownershipRecordPrefix: string = '_compartment-domain';
const ownershipTokenPrefix: string = 'compartment-domain-verification=';

export function buildCompartmentDomainOwnershipRecordName(host: string): string {
  return `${ownershipRecordPrefix}.${host}`;
}

export function buildCompartmentDomainOwnershipValue(verificationId: string): string {
  return `${ownershipTokenPrefix}${verificationId}`;
}
