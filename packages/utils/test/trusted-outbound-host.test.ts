import { describe, expect, it } from 'vitest';
import { parseOptionalTrustedOutboundHostList } from '../src';

describe('parseOptionalTrustedOutboundHostList', (): void => {
  it('canonicalizes trusted outbound hostnames', (): void => {
    expect(
      parseOptionalTrustedOutboundHostList(
        'GitHub.Enterprise.Example, idp.example.com:8443, idp.example.com:443',
        'COMPARTMENT_TRUSTED_OUTBOUND_HOSTS',
      ),
    ).toEqual(['github.enterprise.example', 'idp.example.com:8443', 'idp.example.com']);
  });

  it('rejects IP literal entries', (): void => {
    for (const value of [readExamplePublicAddress(), `[${readExamplePublicIpv6Address()}]`]) {
      expect((): string[] => parseOptionalTrustedOutboundHostList(value, 'COMPARTMENT_TRUSTED_OUTBOUND_HOSTS')).toThrow(
        'COMPARTMENT_TRUSTED_OUTBOUND_HOSTS must be empty or a comma-separated list',
      );
    }
  });
});

function readExamplePublicAddress(): string {
  return ['93', '184', '216', '34'].join('.');
}

function readExamplePublicIpv6Address(): string {
  return ['2606', '2800', '220', '1', '248', '1893', '25c8', '1946'].join(':');
}
