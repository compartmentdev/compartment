import { describe, expect, it } from 'vitest';
import {
  renderSelfHostedDomainEnvironment,
  renderSelfHostedManagedDomainEnvironment,
} from '../src/self-hosted-domain-environment';
import {
  buildSelfHostedEnvironment,
  buildPublishedSelfHostedRuntimeSelection,
  buildUpdatedSelfHostedEnvironment,
  readSelfHostedImageRefsFromEnvironmentText,
} from '../src/self-hosted-env';
import { readSelfHostedEnvironmentValues } from '../src/self-hosted-env-file';
import type { BuildSelfHostedEnvironmentInput, RenderedSelfHostedEnvironment } from '../src/self-hosted-env.types';

type ArtifactRegistryCredentialInput = Pick<
  BuildSelfHostedEnvironmentInput,
  | 'artifactRegistryReadPassword'
  | 'artifactRegistryReadUsername'
  | 'artifactRegistryWritePassword'
  | 'artifactRegistryWriteUsername'
>;

const selfHostedBuildKitAddress: string = 'unix:///run/buildkit/buildkitd.sock';

describe('self-hosted environment helpers', (): void => {
  it('renders the self-hosted environment with generated image refs and secrets', (): void => {
    const rendered: RenderedSelfHostedEnvironment = buildSelfHostedEnvironment({
      acmeEmail: 'admin@example.com',
      baseDomain: 'example.com',
      dockerWorkDirectory: '/var/lib/compartment/self-hosted/docker-work',
      edgeToken: 'edge-token',
      ...createArtifactRegistryCredentialInput(),
      postgresPassword: 'postgres-password',
      publicHttpPort: 80,
      publicHttpsPort: 443,
      publicIngressIpv4: '',
      publicIngressIpv6: '',
      runtimeSelection: buildPublishedSelfHostedRuntimeSelection('1.2.3'),
      sessionSecret: 'session-secret',
      nodeAgentSocketPath: '/var/run/compartment/node/agent.sock',
      systemApiSocketPath: '/var/run/compartment/api/system-api.sock',
      systemToken: 'system-token',
      templateText: buildTemplateText(),
      variablesMasterKey: 'a'.repeat(64),
      runtimeControlToken: 'runtime-token',
    });

    expect(rendered.values.BUILDKIT_ADDR).toBe(selfHostedBuildKitAddress);
    expect(rendered.values.COMPARTMENT_BASE_DOMAIN).toBe('example.com');
    expect(rendered.values.COMPARTMENT_API_IMAGE).toBe('ghcr.io/compartmentdev/compartment-api:1.2.3');
    expect(rendered.values.COMPARTMENT_CADDY_IMAGE).toBe('ghcr.io/compartmentdev/compartment-caddy:1.2.3');
    expect(rendered.values.COMPARTMENT_RUNTIME_PROBE_IMAGE).toBe(
      'ghcr.io/compartmentdev/compartment-runtime-probe:1.2.3',
    );
    expect(rendered.values.COMPARTMENT_ARTIFACT_REGISTRY_HOST).toBe('127.0.0.1');
    expect(rendered.values.COMPARTMENT_ARTIFACT_REGISTRY_PORT).toBe('39461');
    expect(rendered.values.COMPARTMENT_ARTIFACT_REGISTRY_INTERNAL_HOST).toBe('registry-auth');
    expect(rendered.values.COMPARTMENT_ARTIFACT_REGISTRY_INTERNAL_PORT).toBe('5000');
    expect(rendered.values.COMPARTMENT_ARTIFACT_REGISTRY_READ_USERNAME).toBe('reader');
    expect(rendered.values.COMPARTMENT_ARTIFACT_REGISTRY_READ_PASSWORD).toBe('read-password');
    expect(rendered.values.COMPARTMENT_ARTIFACT_REGISTRY_WRITE_USERNAME).toBe('writer');
    expect(rendered.values.COMPARTMENT_ARTIFACT_REGISTRY_WRITE_PASSWORD).toBe('write-password');
    expect(rendered.values.COMPARTMENT_DATABASE_URL).toBe(
      'postgresql://postgres:postgres-password@postgres:5432/compartment',
    );
    expect(rendered.values.COMPARTMENT_DOCKER_NAMESPACE).toBe('compartment');
    expect(rendered.values.COMPARTMENT_RUNTIME_CONNECTIVITY_MODE).toBe('network');
    expect(rendered.values.COMPARTMENT_RUNTIME_DEFAULT_UPSTREAM_HOST).toBe('host.docker.internal');
    expect(rendered.values.COMPARTMENT_AUDIT_RETENTION_CLEANUP_CRON).toBe('0 3 * * *');
    expect(rendered.values.COMPARTMENT_AUDIT_RETENTION_CLEANUP_BATCH_SIZE).toBe('1000');
    expect(rendered.values.COMPARTMENT_AUDIT_RETENTION_CLEANUP_MAX_BATCHES).toBe('100');
    expect(rendered.values.COMPARTMENT_AUDIT_FILE_SINK_ENABLED).toBe('false');
    expect(rendered.values.COMPARTMENT_AUDIT_FILE_SINK_DIR).toBe('/var/lib/compartment/audit-logs');
    expect(rendered.values.COMPARTMENT_AUDIT_FILE_SINK_ROTATE_INTERVAL).toBe('1d');
    expect(rendered.values.COMPARTMENT_AUDIT_FILE_SINK_ROTATE_SIZE).toBe('64M');
    expect(rendered.values.COMPARTMENT_AUDIT_FILE_SINK_RETENTION_FILES).toBe('30');
    expect(rendered.values.COMPARTMENT_DOCKER_WORK_DIR).toBe('/var/lib/compartment/self-hosted/docker-work');
    expect(rendered.values.COMPARTMENT_PUBLIC_HTTP_PORT).toBe('80');
    expect(rendered.values.COMPARTMENT_PUBLIC_HTTPS_PORT).toBe('443');
    expect(rendered.values.COMPARTMENT_PUBLIC_INGRESS_IPV4).toBe('');
    expect(rendered.values.COMPARTMENT_PUBLIC_INGRESS_IPV6).toBe('');
    expect(rendered.values.COMPARTMENT_PUBLIC_PROTOCOL).toBe('https');
    expect(rendered.values.COMPARTMENT_CADDY_TLS_MODE).toBe('internal');
    expect(rendered.values.COMPARTMENT_CUSTOM_TLS_CERT_FILE).toBe('/etc/compartment/tls/fullchain.pem');
    expect(rendered.values.COMPARTMENT_CUSTOM_TLS_DIR).toBe('/etc/compartment/tls');
    expect(rendered.values.COMPARTMENT_CUSTOM_TLS_KEY_FILE).toBe('/etc/compartment/tls/privkey.pem');
    expect(rendered.values.COMPARTMENT_SYSTEM_API_SOCKET).toBe('/var/run/compartment/api/system-api.sock');
    expect(rendered.values.COMPARTMENT_SYSTEM_TOKEN).toBe('system-token');
    expect(rendered.values.COMPARTMENT_ACME_CA_URL).toBe('');
    expect(rendered.values.COMPARTMENT_ACME_EMAIL).toBe('admin@example.com');
    expect(rendered.values.COMPARTMENT_MANAGED_DOMAIN_BROKER_TOKEN).toBe('');
    expect(rendered.values.COMPARTMENT_MANAGED_DOMAIN_BROKER_URL).toBe('');
    expect(rendered.text).toContain('COMPARTMENT_BASE_DOMAIN=example.com');
    expect(rendered.text).toContain('COMPARTMENT_PUBLIC_HTTP_PORT=80');
    expect(rendered.text).toContain('COMPARTMENT_PUBLIC_HTTPS_PORT=443');
    expect(rendered.text).toContain('COMPARTMENT_PUBLIC_INGRESS_IPV4=');
    expect(rendered.text).toContain('COMPARTMENT_PUBLIC_INGRESS_IPV6=');
    expect(rendered.text).toContain('COMPARTMENT_PUBLIC_PROTOCOL=https');
    expect(rendered.text).toContain('COMPARTMENT_CADDY_TLS_MODE=internal');
    expect(rendered.text).toContain('COMPARTMENT_ACME_EMAIL=admin@example.com');
    expect(rendered.text).toContain('COMPARTMENT_AUDIT_RETENTION_CLEANUP_CRON="0 3 * * *"');
    expect(rendered.text).toContain('COMPARTMENT_AUDIT_FILE_SINK_ENABLED=false');
    expect(rendered.text).toContain('COMPARTMENT_AUDIT_FILE_SINK_DIR=/var/lib/compartment/audit-logs');
    expect(rendered.text).toContain('COMPARTMENT_RUNTIME_CONTROL_TOKEN=runtime-token');
    expect(rendered.text).toContain('COMPARTMENT_SYSTEM_API_SOCKET=/var/run/compartment/api/system-api.sock');
    expect(rendered.text).toContain('COMPARTMENT_SYSTEM_TOKEN=system-token');
    expect(rendered.text).toContain('COMPARTMENT_ARTIFACT_REGISTRY_READ_USERNAME=reader');
    expect(rendered.text).toContain('COMPARTMENT_ARTIFACT_REGISTRY_WRITE_USERNAME=writer');
    expect(rendered.text).toContain(`BUILDKIT_ADDR=${selfHostedBuildKitAddress}`);
  });

  it('renders Docker Hub image refs when selected', (): void => {
    const rendered: RenderedSelfHostedEnvironment = buildSelfHostedEnvironment({
      acmeEmail: 'admin@example.com',
      baseDomain: 'example.com',
      dockerWorkDirectory: '/var/lib/compartment/self-hosted/docker-work',
      edgeToken: 'edge-token',
      ...createArtifactRegistryCredentialInput(),
      postgresPassword: 'postgres-password',
      publicHttpPort: 80,
      publicHttpsPort: 443,
      publicIngressIpv4: '',
      publicIngressIpv6: '',
      runtimeSelection: buildPublishedSelfHostedRuntimeSelection('1.2.3', 'docker-hub'),
      sessionSecret: 'session-secret',
      nodeAgentSocketPath: '/var/run/compartment/node/agent.sock',
      systemApiSocketPath: '/var/run/compartment/api/system-api.sock',
      systemToken: 'system-token',
      templateText: buildTemplateText(),
      variablesMasterKey: 'a'.repeat(64),
      runtimeControlToken: 'runtime-token',
    });

    expect(rendered.values.COMPARTMENT_API_IMAGE).toBe('docker.io/compartmentdev/compartment-api:1.2.3');
    expect(rendered.values.COMPARTMENT_CADDY_IMAGE).toBe('docker.io/compartmentdev/compartment-caddy:1.2.3');
    expect(rendered.values.COMPARTMENT_RUNTIME_PROBE_IMAGE).toBe(
      'docker.io/compartmentdev/compartment-runtime-probe:1.2.3',
    );
  });

  it('reads installed self-hosted image refs from environment text', (): void => {
    expect(readSelfHostedImageRefsFromEnvironmentText(buildTemplateText())).toEqual({
      apiImage: 'docker.io/compartmentdev/compartment-api:latest',
      caddyImage: 'docker.io/compartmentdev/compartment-caddy:latest',
      edgeImage: 'docker.io/compartmentdev/compartment-edge:latest',
      runtimeProbeImage: 'docker.io/compartmentdev/compartment-runtime-probe:latest',
      workerImage: 'docker.io/compartmentdev/compartment-worker:latest',
    });
  });

  it('renders managed-domain TLS values for managed self-hosted installs', (): void => {
    const rendered: RenderedSelfHostedEnvironment = buildSelfHostedEnvironment({
      acmeEmail: 'admin@example.com',
      baseDomain: '4h8z9k2m1p7q.app.compartment.run',
      dockerWorkDirectory: '/var/lib/compartment/self-hosted/docker-work',
      edgeToken: 'edge-token',
      ...createArtifactRegistryCredentialInput(),
      managedDomain: {
        acmeEmail: 'admin@example.com',
        baseDomain: '4h8z9k2m1p7q.app.compartment.run',
        brokerUrl: 'https://broker.compartment.run',
        managedDomainBrokerToken: 'broker-token',
      },
      postgresPassword: 'postgres-password',
      publicHttpPort: 80,
      publicHttpsPort: 443,
      publicIngressIpv4: '203.0.113.10',
      publicIngressIpv6: '',
      runtimeSelection: buildPublishedSelfHostedRuntimeSelection('1.2.3'),
      sessionSecret: 'session-secret',
      nodeAgentSocketPath: '/var/run/compartment/node/agent.sock',
      systemApiSocketPath: '/var/run/compartment/api/system-api.sock',
      systemToken: 'system-token',
      templateText: buildTemplateText(),
      variablesMasterKey: 'a'.repeat(64),
      runtimeControlToken: 'runtime-token',
    });

    expect(rendered.values.COMPARTMENT_PUBLIC_PROTOCOL).toBe('https');
    expect(rendered.values.COMPARTMENT_PUBLIC_INGRESS_IPV4).toBe('203.0.113.10');
    expect(rendered.values.COMPARTMENT_PUBLIC_INGRESS_IPV6).toBe('');
    expect(rendered.values.COMPARTMENT_CADDY_TLS_MODE).toBe('managed');
    expect(rendered.values.COMPARTMENT_ACME_CA_URL).toBe('https://acme.zerossl.com/v2/DV90');
    expect(rendered.values.COMPARTMENT_ACME_EMAIL).toBe('admin@example.com');
    expect(rendered.values.COMPARTMENT_MANAGED_DOMAIN_BROKER_TOKEN).toBe('broker-token');
    expect(rendered.values.COMPARTMENT_MANAGED_DOMAIN_BROKER_URL).toBe('https://broker.compartment.run');
    expect(rendered.text).toContain('COMPARTMENT_PUBLIC_PROTOCOL=https');
    expect(rendered.text).toContain('COMPARTMENT_CADDY_TLS_MODE=managed');
    expect(rendered.text).toContain('COMPARTMENT_ACME_CA_URL=https://acme.zerossl.com/v2/DV90');
  });

  it('does not backfill broker env from managed metadata during update', (): void => {
    const rendered: RenderedSelfHostedEnvironment = buildUpdatedSelfHostedEnvironment({
      acmeEmail: 'admin@example.com',
      baseDomain: 'example.com',
      currentValues: readSelfHostedEnvironmentValues(buildTemplateText()),
      dockerWorkDirectory: '/var/lib/compartment/self-hosted/docker-work',
      edgeToken: 'edge-token',
      ...createArtifactRegistryCredentialInput(),
      managedDomain: {
        acmeEmail: 'admin@example.com',
        baseDomain: '4h8z9k2m1p7q.app.compartment.run',
        brokerUrl: 'https://broker.compartment.run',
        managedDomainBrokerToken: 'broker-token',
      },
      postgresPassword: 'postgres-password',
      publicHttpPort: 80,
      publicHttpsPort: 443,
      publicIngressIpv4: '',
      publicIngressIpv6: '',
      runtimeControlToken: 'runtime-token',
      runtimeSelection: buildPublishedSelfHostedRuntimeSelection('1.2.3'),
      sessionSecret: 'session-secret',
      nodeAgentSocketPath: '/var/run/compartment/node/agent.sock',
      systemApiSocketPath: '/var/run/compartment/api/system-api.sock',
      systemToken: 'system-token',
      templateText: buildTemplateText(),
      variablesMasterKey: 'a'.repeat(64),
    });

    expect(rendered.values.COMPARTMENT_MANAGED_DOMAIN_BROKER_TOKEN).toBe('');
    expect(rendered.values.COMPARTMENT_MANAGED_DOMAIN_BROKER_URL).toBe('');
  });

  it('preserves configured public protocol during update', (): void => {
    const rendered: RenderedSelfHostedEnvironment = buildUpdatedSelfHostedEnvironment({
      acmeEmail: 'admin@example.com',
      baseDomain: 'example.com',
      currentValues: readSelfHostedEnvironmentValues(buildTemplateText()),
      dockerWorkDirectory: '/var/lib/compartment/self-hosted/docker-work',
      edgeToken: 'edge-token',
      ...createArtifactRegistryCredentialInput(),
      postgresPassword: 'postgres-password',
      publicHttpPort: 80,
      publicHttpsPort: 443,
      publicIngressIpv4: '',
      publicIngressIpv6: '',
      runtimeControlToken: 'runtime-token',
      runtimeSelection: buildPublishedSelfHostedRuntimeSelection('1.2.3'),
      sessionSecret: 'session-secret',
      nodeAgentSocketPath: '/var/run/compartment/node/agent.sock',
      systemApiSocketPath: '/var/run/compartment/api/system-api.sock',
      systemToken: 'system-token',
      templateText: buildTemplateText(),
      variablesMasterKey: 'a'.repeat(64),
    });

    expect(rendered.values.COMPARTMENT_PUBLIC_PROTOCOL).toBe('http');
  });

  it('migrates the self-hosted BuildKit address during update', (): void => {
    const rendered: RenderedSelfHostedEnvironment = buildUpdatedSelfHostedEnvironment({
      acmeEmail: 'admin@example.com',
      baseDomain: 'example.com',
      currentValues: readSelfHostedEnvironmentValues(buildTemplateText()),
      dockerWorkDirectory: '/var/lib/compartment/self-hosted/docker-work',
      edgeToken: 'edge-token',
      ...createArtifactRegistryCredentialInput(),
      postgresPassword: 'postgres-password',
      publicHttpPort: 80,
      publicHttpsPort: 443,
      publicIngressIpv4: '',
      publicIngressIpv6: '',
      runtimeControlToken: 'runtime-token',
      runtimeSelection: buildPublishedSelfHostedRuntimeSelection('1.2.3'),
      sessionSecret: 'session-secret',
      nodeAgentSocketPath: '/var/run/compartment/node/agent.sock',
      systemApiSocketPath: '/var/run/compartment/api/system-api.sock',
      systemToken: 'system-token',
      templateText: buildTemplateText(),
      variablesMasterKey: 'a'.repeat(64),
    });

    expect(rendered.values.BUILDKIT_ADDR).toBe(selfHostedBuildKitAddress);
    expect(rendered.text).toContain(`BUILDKIT_ADDR=${selfHostedBuildKitAddress}`);
    expect(rendered.text).not.toContain('BUILDKIT_ADDR=tcp://builder:1234');
  });

  it('renders custom public ports into the self-hosted environment', (): void => {
    const rendered: RenderedSelfHostedEnvironment = buildSelfHostedEnvironment({
      acmeEmail: 'admin@example.com',
      baseDomain: 'example.com',
      dockerWorkDirectory: '/var/lib/compartment/self-hosted/docker-work',
      edgeToken: 'edge-token',
      ...createArtifactRegistryCredentialInput(),
      postgresPassword: 'postgres-password',
      publicHttpPort: 8080,
      publicHttpsPort: 8443,
      publicIngressIpv4: '',
      publicIngressIpv6: '',
      runtimeSelection: buildPublishedSelfHostedRuntimeSelection('1.2.3'),
      sessionSecret: 'session-secret',
      nodeAgentSocketPath: '/var/run/compartment/node/agent.sock',
      systemApiSocketPath: '/var/run/compartment/api/system-api.sock',
      systemToken: 'system-token',
      templateText: buildTemplateText(),
      variablesMasterKey: 'a'.repeat(64),
      runtimeControlToken: 'runtime-token',
    });

    expect(rendered.values.COMPARTMENT_PUBLIC_HTTP_PORT).toBe('8080');
    expect(rendered.values.COMPARTMENT_PUBLIC_HTTPS_PORT).toBe('8443');
  });

  it('renders custom HTTP domain runtime overrides without ACME settings', (): void => {
    const renderedText: string = renderSelfHostedDomainEnvironment(buildTemplateText(), {
      baseDomain: 'customer.example.com',
      caddyMode: 'custom-http',
      domainKind: 'custom',
      publicScheme: 'https',
      tlsMode: 'external',
    });

    expect(renderedText).toContain('COMPARTMENT_BASE_DOMAIN=customer.example.com');
    expect(renderedText).toContain('COMPARTMENT_PUBLIC_PROTOCOL=https');
    expect(renderedText).toContain('COMPARTMENT_CADDY_TLS_MODE=custom-http');
    expect(renderedText).toContain('COMPARTMENT_ACME_CA_URL=');
    expect(renderedText).toContain('COMPARTMENT_MANAGED_DOMAIN_BROKER_TOKEN=');
  });

  it('does not modify broker env when rendering custom domain runtime overrides', (): void => {
    const renderedText: string = renderSelfHostedDomainEnvironment(
      buildTemplateText()
        .replace('COMPARTMENT_MANAGED_DOMAIN_BROKER_TOKEN=\n', 'COMPARTMENT_MANAGED_DOMAIN_BROKER_TOKEN=broker-token\n')
        .replace(
          'COMPARTMENT_MANAGED_DOMAIN_BROKER_URL=\n',
          'COMPARTMENT_MANAGED_DOMAIN_BROKER_URL=https://broker.compartment.run\n',
        ),
      {
        baseDomain: 'customer.example.com',
        caddyMode: 'custom-http',
        domainKind: 'custom',
        publicScheme: 'https',
        tlsMode: 'external',
      },
    );

    expect(renderedText).toContain('COMPARTMENT_MANAGED_DOMAIN_BROKER_TOKEN=broker-token');
    expect(renderedText).toContain('COMPARTMENT_MANAGED_DOMAIN_BROKER_URL=https://broker.compartment.run');
  });

  it('renders custom certificate domain runtime overrides with staged certificate paths', (): void => {
    const renderedText: string = renderSelfHostedDomainEnvironment(
      buildTemplateText().replace('COMPARTMENT_ACME_EMAIL=\n', 'COMPARTMENT_ACME_EMAIL=admin@example.com\n'),
      {
        baseDomain: 'customer.example.com',
        caddyMode: 'custom-cert',
        domainKind: 'custom',
        publicScheme: 'https',
        tlsMode: 'custom-cert',
      },
      {
        certificatePath: '/etc/compartment/tls/domop_123/fullchain.pem',
        privateKeyPath: '/etc/compartment/tls/domop_123/privkey.pem',
      },
    );

    expect(renderedText).toContain('COMPARTMENT_BASE_DOMAIN=customer.example.com');
    expect(renderedText).toContain('COMPARTMENT_PUBLIC_PROTOCOL=https');
    expect(renderedText).toContain('COMPARTMENT_CADDY_TLS_MODE=custom-cert');
    expect(renderedText).toContain('COMPARTMENT_CUSTOM_TLS_CERT_FILE=/etc/compartment/tls/domop_123/fullchain.pem');
    expect(renderedText).toContain('COMPARTMENT_CUSTOM_TLS_KEY_FILE=/etc/compartment/tls/domop_123/privkey.pem');
    expect(renderedText).toContain('COMPARTMENT_ACME_CA_URL=https://acme.zerossl.com/v2/DV90');
    expect(renderedText).toContain('COMPARTMENT_ACME_EMAIL=admin@example.com');
  });

  it('rejects control characters when rendering staged certificate paths into the runtime env', (): void => {
    expect((): string =>
      renderSelfHostedDomainEnvironment(
        buildTemplateText().replace('COMPARTMENT_ACME_EMAIL=\n', 'COMPARTMENT_ACME_EMAIL=admin@example.com\n'),
        {
          baseDomain: 'customer.example.com',
          caddyMode: 'custom-cert',
          domainKind: 'custom',
          publicScheme: 'https',
          tlsMode: 'custom-cert',
        },
        {
          certificatePath: '/etc/compartment/tls/domop_123/fullchain.pem\nINJECTED=value',
          privateKeyPath: '/etc/compartment/tls/domop_123/privkey.pem',
        },
      ),
    ).toThrowError(
      'The self-hosted environment value for COMPARTMENT_CUSTOM_TLS_CERT_FILE must not contain control characters.',
    );
  });

  it('does not modify broker env when rendering managed domain runtime overrides', (): void => {
    const renderedText: string = renderSelfHostedManagedDomainEnvironment(
      buildTemplateText()
        .replace('COMPARTMENT_MANAGED_DOMAIN_BROKER_TOKEN=\n', 'COMPARTMENT_MANAGED_DOMAIN_BROKER_TOKEN=old-token\n')
        .replace(
          'COMPARTMENT_MANAGED_DOMAIN_BROKER_URL=\n',
          'COMPARTMENT_MANAGED_DOMAIN_BROKER_URL=https://old-broker.example\n',
        ),
      {
        acmeEmail: 'admin@example.com',
        baseDomain: '4h8z9k2m1p7q.app.compartment.run',
        brokerUrl: 'https://broker.compartment.run',
        managedDomainBrokerToken: 'broker-token',
      },
    );

    expect(renderedText).toContain('COMPARTMENT_BASE_DOMAIN=4h8z9k2m1p7q.app.compartment.run');
    expect(renderedText).toContain('COMPARTMENT_PUBLIC_PROTOCOL=https');
    expect(renderedText).toContain('COMPARTMENT_CADDY_TLS_MODE=managed');
    expect(renderedText).toContain('COMPARTMENT_ACME_CA_URL=https://acme.zerossl.com/v2/DV90');
    expect(renderedText).toContain('COMPARTMENT_ACME_EMAIL=admin@example.com');
    expect(renderedText).toContain('COMPARTMENT_MANAGED_DOMAIN_BROKER_TOKEN=old-token');
    expect(renderedText).toContain('COMPARTMENT_MANAGED_DOMAIN_BROKER_URL=https://old-broker.example');
    expect(renderedText).not.toContain('COMPARTMENT_MANAGED_DOMAIN_BROKER_TOKEN=broker-token');
    expect(renderedText).not.toContain('COMPARTMENT_MANAGED_DOMAIN_BROKER_URL=https://broker.compartment.run');
  });

  it('fails fast when the env template omits a required override variable', (): void => {
    expect(
      (): RenderedSelfHostedEnvironment =>
        buildSelfHostedEnvironment({
          acmeEmail: 'admin@example.com',
          baseDomain: 'example.com',
          dockerWorkDirectory: '/var/lib/compartment/self-hosted/docker-work',
          edgeToken: 'edge-token',
          ...createArtifactRegistryCredentialInput(),
          postgresPassword: 'postgres-password',
          publicHttpPort: 80,
          publicHttpsPort: 443,
          publicIngressIpv4: '',
          publicIngressIpv6: '',
          runtimeSelection: buildPublishedSelfHostedRuntimeSelection('1.2.3'),
          sessionSecret: 'session-secret',
          nodeAgentSocketPath: '/var/run/compartment/node/agent.sock',
          systemApiSocketPath: '/var/run/compartment/api/system-api.sock',
          systemToken: 'system-token',
          templateText: buildTemplateTextWithout('COMPARTMENT_EDGE_IMAGE'),
          variablesMasterKey: 'a'.repeat(64),
          runtimeControlToken: 'runtime-token',
        }),
    ).toThrowError('The bundled self-hosted env template is missing required variables: COMPARTMENT_EDGE_IMAGE.');
  });

  it('rejects control characters when rendering install-time env values', (): void => {
    expect(
      (): RenderedSelfHostedEnvironment =>
        buildSelfHostedEnvironment({
          acmeEmail: 'admin@example.com',
          baseDomain: 'example.com',
          dockerWorkDirectory: '/var/lib/compartment/self-hosted/docker-work',
          edgeToken: 'edge-token\nSECOND=value',
          ...createArtifactRegistryCredentialInput(),
          postgresPassword: 'postgres-password',
          publicHttpPort: 80,
          publicHttpsPort: 443,
          publicIngressIpv4: '',
          publicIngressIpv6: '',
          runtimeSelection: buildPublishedSelfHostedRuntimeSelection('1.2.3'),
          sessionSecret: 'session-secret',
          nodeAgentSocketPath: '/var/run/compartment/node/agent.sock',
          systemApiSocketPath: '/var/run/compartment/api/system-api.sock',
          systemToken: 'system-token',
          templateText: buildTemplateText(),
          variablesMasterKey: 'a'.repeat(64),
          runtimeControlToken: 'runtime-token',
        }),
    ).toThrowError('The self-hosted environment value for COMPARTMENT_EDGE_TOKEN must not contain control characters.');
  });

  it('preserves existing env values from CRLF templates when rendering domain overrides', (): void => {
    const renderedText: string = renderSelfHostedDomainEnvironment(
      buildTemplateText()
        .replace('COMPARTMENT_ACME_EMAIL=\n', 'COMPARTMENT_ACME_EMAIL=admin@example.com\n')
        .replace(/\n/g, '\r\n'),
      {
        baseDomain: 'customer.example.com',
        caddyMode: 'custom-cert',
        domainKind: 'custom',
        publicScheme: 'https',
        tlsMode: 'custom-cert',
      },
      {
        certificatePath: '/etc/compartment/tls/domop_123/fullchain.pem',
        privateKeyPath: '/etc/compartment/tls/domop_123/privkey.pem',
      },
    );

    expect(renderedText).toContain('COMPARTMENT_ACME_EMAIL=admin@example.com');
  });
});

function createArtifactRegistryCredentialInput(): ArtifactRegistryCredentialInput {
  return {
    artifactRegistryReadPassword: 'read-password',
    artifactRegistryReadUsername: 'reader',
    artifactRegistryWritePassword: 'write-password',
    artifactRegistryWriteUsername: 'writer',
  };
}

function buildTemplateText(): string {
  return `BUILDKIT_ADDR=tcp://builder:1234
COMPARTMENT_API_URL=http://127.0.0.1:39444
COMPARTMENT_API_IMAGE=docker.io/compartmentdev/compartment-api:latest
COMPARTMENT_RUNTIME_PROBE_IMAGE=docker.io/compartmentdev/compartment-runtime-probe:latest
COMPARTMENT_ACME_CA_URL=
COMPARTMENT_ACME_EMAIL=
COMPARTMENT_MANAGED_DOMAIN_BROKER_TOKEN=
COMPARTMENT_MANAGED_DOMAIN_BROKER_URL=
COMPARTMENT_ARTIFACT_REGISTRY_HOST=127.0.0.1
COMPARTMENT_ARTIFACT_REGISTRY_PORT=39461
COMPARTMENT_ARTIFACT_REGISTRY_INTERNAL_HOST=registry-auth
COMPARTMENT_ARTIFACT_REGISTRY_INTERNAL_PORT=5000
COMPARTMENT_ARTIFACT_REGISTRY_READ_USERNAME=
COMPARTMENT_ARTIFACT_REGISTRY_READ_PASSWORD=
COMPARTMENT_ARTIFACT_REGISTRY_WRITE_USERNAME=
COMPARTMENT_ARTIFACT_REGISTRY_WRITE_PASSWORD=
COMPARTMENT_AUDIT_RETENTION_DAYS=90
COMPARTMENT_AUDIT_RETENTION_CLEANUP_CRON="0 3 * * *"
COMPARTMENT_AUDIT_RETENTION_CLEANUP_BATCH_SIZE=1000
COMPARTMENT_AUDIT_RETENTION_CLEANUP_MAX_BATCHES=100
COMPARTMENT_AUDIT_FILE_SINK_ENABLED=false
COMPARTMENT_AUDIT_FILE_SINK_DIR=/var/lib/compartment/audit-logs
COMPARTMENT_AUDIT_FILE_SINK_ROTATE_INTERVAL=1d
COMPARTMENT_AUDIT_FILE_SINK_ROTATE_SIZE=64M
COMPARTMENT_AUDIT_FILE_SINK_RETENTION_FILES=30
COMPARTMENT_BASE_DOMAIN=localhost
COMPARTMENT_CADDY_IMAGE=docker.io/compartmentdev/compartment-caddy:latest
COMPARTMENT_CADDY_TLS_MODE=internal
COMPARTMENT_CUSTOM_TLS_CERT_FILE=/etc/compartment/tls/fullchain.pem
COMPARTMENT_CUSTOM_TLS_DIR=/etc/compartment/tls
COMPARTMENT_CUSTOM_TLS_KEY_FILE=/etc/compartment/tls/privkey.pem
COMPARTMENT_DATABASE_URL=postgresql://postgres:postgres@postgres:5432/compartment
COMPARTMENT_DOCKER_NAMESPACE=compartment
COMPARTMENT_DOCKER_WORK_DIR=/var/lib/compartment/self-hosted/docker-work
COMPARTMENT_EDGE_IMAGE=docker.io/compartmentdev/compartment-edge:latest
COMPARTMENT_EDGE_TOKEN=change-me-edge-token
COMPARTMENT_NODE_AGENT_SOCKET=/var/run/compartment/node/agent.sock
COMPARTMENT_NODE_VERSION=0.1.0
COMPARTMENT_POSTGRES_PASSWORD=postgres
COMPARTMENT_PUBLIC_HTTP_PORT=80
COMPARTMENT_PUBLIC_HTTPS_PORT=443
COMPARTMENT_PUBLIC_INGRESS_IPV4=
COMPARTMENT_PUBLIC_INGRESS_IPV6=
COMPARTMENT_PUBLIC_PROTOCOL=http
COMPARTMENT_RESOURCE_BACKUP_DIR=/var/lib/compartment/resource-backups
COMPARTMENT_RUNTIME_CONNECTIVITY_MODE=network
COMPARTMENT_RUNTIME_DEFAULT_UPSTREAM_HOST=host.docker.internal
COMPARTMENT_ROLLBACK_RETENTION_LIMIT=
COMPARTMENT_SESSION_SECRET=change-me
COMPARTMENT_SYSTEM_API_SOCKET=/var/run/compartment/api/system-api.sock
COMPARTMENT_SYSTEM_TOKEN=change-me-system-token
COMPARTMENT_VARIABLES_MASTER_KEY=1111111111111111111111111111111111111111111111111111111111111111
COMPARTMENT_WORKER_IMAGE=docker.io/compartmentdev/compartment-worker:latest
COMPARTMENT_RUNTIME_CONTROL_TOKEN=change-me-runtime-control-token`;
}

function buildTemplateTextWithout(variableName: string): string {
  return buildTemplateText()
    .split('\n')
    .filter((line: string): boolean => !line.startsWith(`${variableName}=`))
    .join('\n');
}
