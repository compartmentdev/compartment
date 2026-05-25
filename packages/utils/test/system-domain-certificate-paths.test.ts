import { describe, expect, it } from 'vitest';
import { buildPendingSystemDomainCertificatePaths } from '../src/system-domain-certificate-paths';

describe('system domain certificate paths', (): void => {
  it('builds canonical staged certificate paths from an absolute TLS directory', (): void => {
    expect(buildPendingSystemDomainCertificatePaths('/etc/compartment/tls', 'domop_123')).toEqual({
      certificatePath: '/etc/compartment/tls/domop_123/fullchain.pem',
      privateKeyPath: '/etc/compartment/tls/domop_123/privkey.pem',
    });
  });

  it('rejects a relative TLS directory', (): void => {
    expect((): void => {
      buildPendingSystemDomainCertificatePaths('tls', 'domop_123');
    }).toThrow('COMPARTMENT_CUSTOM_TLS_DIR must be an absolute path.');
  });

  it('rejects operation ids that are not a single safe path segment', (): void => {
    expect((): void => {
      buildPendingSystemDomainCertificatePaths('/etc/compartment/tls', '../escape');
    }).toThrow('The pending system-domain operation id must be a single safe path segment.');
  });
});
