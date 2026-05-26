import { describe, expect, it } from 'vitest';
import {
  assertInstallModeSelection,
  readInstallBaseDomain,
  readInstallImageRegistry,
  readInstallManagedDomainBrokerUrl,
  readInstallImageSource,
  resolveInstallVersionSelection,
  usesManagedInstallDomain,
} from '../src/commands/install/install.command.options';

const defaultManagedDomainBrokerUrl: string = 'https://broker.compartment.run';

describe('readInstallImageSource', (): void => {
  it('defaults to registry when no image source is provided', (): void => {
    expect(readInstallImageSource(undefined)).toBe('registry');
  });

  it('accepts an explicit registry image source', (): void => {
    expect(readInstallImageSource('registry')).toBe('registry');
  });

  it('accepts a local image source', (): void => {
    expect(readInstallImageSource('local')).toBe('local');
  });

  it('rejects unknown image sources', (): void => {
    expect((): string => readInstallImageSource('broken')).toThrowError(
      'Install image source must be `registry` or `local` when provided.',
    );
  });
});

describe('readInstallImageRegistry', (): void => {
  it('defaults to GitHub Container Registry when no image registry is provided', (): void => {
    expect(readInstallImageRegistry(undefined)).toBe('github');
  });

  it('accepts Docker Hub as an explicit image registry', (): void => {
    expect(readInstallImageRegistry('docker-hub')).toBe('docker-hub');
  });

  it('rejects unknown image registries', (): void => {
    expect((): string => readInstallImageRegistry('broken')).toThrowError(
      'Self-hosted image registry must be `github` or `docker-hub` when provided.',
    );
  });
});

describe('resolveInstallVersionSelection', (): void => {
  it('accepts exact main build sha tags', (): void => {
    expect(resolveInstallVersionSelection('sha-8355ff9c8f6ca4291da56a9dfa99a8fd6c7fad2e')).toEqual({
      usesCliDefault: false,
      value: 'sha-8355ff9c8f6ca4291da56a9dfa99a8fd6c7fad2e',
    });
  });
});

describe('readInstallBaseDomain', (): void => {
  it('uses sslip only for explicit local runtime installs', (): void => {
    expect(
      readInstallBaseDomain({
        localRuntime: true,
        output: 'text',
      }),
    ).toBe('127.0.0.1.sslip.io');
    expect(
      readInstallBaseDomain({
        output: 'text',
      }),
    ).toBeUndefined();
  });
});

describe('readInstallManagedDomainBrokerUrl', (): void => {
  it('uses the default cloud broker url for default installs', (): void => {
    expect(
      readInstallManagedDomainBrokerUrl(
        {
          output: 'text',
        },
        {},
      ),
    ).toBe(defaultManagedDomainBrokerUrl);
  });

  it('reads the explicit broker url for managed-domain installs', (): void => {
    expect(
      readInstallManagedDomainBrokerUrl({
        brokerUrl: 'http://127.0.0.1:4545/',
        output: 'text',
      }),
    ).toBe('http://127.0.0.1:4545');
  });

  it('reads the env broker url for managed-domain installs', (): void => {
    expect(
      readInstallManagedDomainBrokerUrl(
        {
          output: 'text',
        },
        {
          COMPARTMENT_MANAGED_DOMAIN_BROKER_URL: 'https://broker.dev.compartment.run/',
        },
      ),
    ).toBe('https://broker.dev.compartment.run');
  });

  it('ignores an empty env broker url placeholder for managed-domain installs', (): void => {
    expect(
      readInstallManagedDomainBrokerUrl(
        {
          output: 'text',
        },
        {
          COMPARTMENT_MANAGED_DOMAIN_BROKER_URL: '',
        },
      ),
    ).toBe(defaultManagedDomainBrokerUrl);
  });
});

describe('usesManagedInstallDomain', (): void => {
  it('uses managed domains for default self-hosted installs', (): void => {
    expect(
      usesManagedInstallDomain({
        output: 'text',
      }),
    ).toBe(true);
  });

  it('does not use managed domains for explicit non-managed install modes', (): void => {
    expect(
      usesManagedInstallDomain({
        baseDomain: 'example.com',
        output: 'text',
      }),
    ).toBe(false);
    expect(
      usesManagedInstallDomain({
        localRuntime: true,
        output: 'text',
      }),
    ).toBe(false);
    expect(
      usesManagedInstallDomain({
        dev: true,
        output: 'text',
      }),
    ).toBe(false);
  });
});

describe('assertInstallModeSelection', (): void => {
  it('allows broker url override for default managed-domain installs', (): void => {
    expect((): void => {
      assertInstallModeSelection({
        brokerUrl: 'http://127.0.0.1:4545',
        output: 'text',
      });
    }).not.toThrow();
  });

  it('rejects broker url override for explicit non-managed install modes', (): void => {
    expect((): void => {
      assertInstallModeSelection({
        baseDomain: 'example.com',
        brokerUrl: 'http://127.0.0.1:4545',
        output: 'text',
      });
    }).toThrow('`--broker-url` requires a managed-domain install.');
  });
});
