import { createHash } from 'node:crypto';
import type { DomainDnsRecord } from '@compartment/contracts';

const brokerAliasOwnershipGroupId: string = 'broker-alias-ownership';
const brokerAliasOwnershipRecordPrefix: string = '_compartment-broker-alias';
const brokerAliasOwnershipValuePrefix: string = 'compartment-broker-alias=';
const brokerAliasOwnershipHashInputPrefix: string = 'compartment-broker-alias:v1';

export function buildManagedDomainBrokerAliasOwnershipDnsRecord(
  baseDomain: string,
  brokerToken: string,
): DomainDnsRecord {
  return {
    groupId: brokerAliasOwnershipGroupId,
    name: buildManagedDomainBrokerAliasOwnershipRecordName(baseDomain),
    purpose: 'ownership',
    recordType: 'TXT',
    required: true,
    value: buildManagedDomainBrokerAliasOwnershipValue(baseDomain, brokerToken),
  };
}

export function buildManagedDomainBrokerAliasOwnershipRecordName(baseDomain: string): string {
  return `${brokerAliasOwnershipRecordPrefix}.${baseDomain}`;
}

export function buildManagedDomainBrokerAliasOwnershipValue(baseDomain: string, brokerToken: string): string {
  const brokerTokenHash: string = createHash('sha256').update(brokerToken).digest('hex');
  const ownershipHash: string = createHash('sha256')
    .update(`${brokerAliasOwnershipHashInputPrefix}:${brokerTokenHash}:${baseDomain}`)
    .digest('hex');

  return `${brokerAliasOwnershipValuePrefix}${ownershipHash}`;
}
