import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readCaddyPlatformAppCookieStripDirectives } from '../src/services/edge-caddy-cookie-strip.service';
import {
  edgePublicControlPlaneExactPathnames,
  edgePublicControlPlaneNestedPrefixPathnames,
  edgePublicControlPlanePrefixPathnames,
} from '../src/edge-public-control-plane-paths';

const repositoryRoot: string = resolve(__dirname, '../../..');
const edgePackageRoot: string = resolve(repositoryRoot, 'packages/edge');
const caddyfilePath: string = resolve(repositoryRoot, 'packages/edge/Caddyfile');
const customCertCaddyfilePath: string = resolve(repositoryRoot, 'packages/edge/Caddyfile.custom-cert');
const customHttpCaddyfilePath: string = resolve(repositoryRoot, 'packages/edge/Caddyfile.custom-http');
const internalCaddyfilePath: string = resolve(repositoryRoot, 'packages/edge/Caddyfile.internal');
const managedCaddyfilePath: string = resolve(repositoryRoot, 'packages/edge/Caddyfile.managed');
const syncCaddyfileScriptPath: string = resolve(repositoryRoot, 'packages/edge/scripts/sync-caddyfile.mjs');

interface PlatformCookieStripTestCase {
  readonly cookieHeader: string;
  readonly expectedCookieHeader: string;
}

describe('edge Caddyfile', (): void => {
  it('matches the generated internal ingress config', (): void => {
    const renderedCaddyfile: string = renderCaddyfile('internal');

    expect(readFileSync(caddyfilePath, 'utf8')).toBe(renderedCaddyfile);
    expect(readFileSync(internalCaddyfilePath, 'utf8')).toBe(renderedCaddyfile);
  });

  it('matches the generated managed ingress config', (): void => {
    const renderedCaddyfile: string = renderCaddyfile('managed');

    expect(readFileSync(managedCaddyfilePath, 'utf8')).toBe(renderedCaddyfile);
  });

  it('matches the generated custom HTTP ingress config', (): void => {
    const renderedCaddyfile: string = renderCaddyfile('custom-http');

    expect(readFileSync(customHttpCaddyfilePath, 'utf8')).toBe(renderedCaddyfile);
  });

  it('matches the generated custom certificate ingress config', (): void => {
    const renderedCaddyfile: string = renderCaddyfile('custom-cert');

    expect(readFileSync(customCertCaddyfilePath, 'utf8')).toBe(renderedCaddyfile);
  });

  it('keeps internal mode on internal certs and only documented public host families', (): void => {
    const renderedCaddyfile: string = renderCaddyfile('internal');

    expect(renderedCaddyfile).toContain('http://*.{$COMPARTMENT_BASE_DOMAIN}:{$COMPARTMENT_CADDY_HTTP_PORT} {');
    expect(renderedCaddyfile).toContain('https://*.{$COMPARTMENT_BASE_DOMAIN}:{$COMPARTMENT_CADDY_HTTPS_PORT} {');
    expect(renderedCaddyfile).not.toContain('*.apps.');
    expect(renderedCaddyfile).toContain('tls internal');
    expect(renderedCaddyfile).not.toContain('on_demand_tls');
  });

  it('allow-lists only documented public control-plane paths', (): void => {
    const renderedCaddyfile: string = renderCaddyfile('internal');
    const publicPathMatchers: string[] = renderCompartmentPublicPathMatchers().split(' ');

    expect(renderedCaddyfile).toContain(`@compartment_public_paths path ${renderCompartmentPublicPathMatchers()}`);
    expect(publicPathMatchers).toEqual(
      expect.arrayContaining([
        '/',
        '/browser-assets',
        '/browser-assets/*',
        '/reset-password',
        '/login/sso',
        '/login/sso/*',
        '/onboarding',
        '/orgs/*',
        '/projects',
        '/projects/*',
        '/users',
        '/users/*',
        '/v1/audit/events',
        '/v1/audit/events/export',
        '/v1/auth/settings',
        '/v1/auth/reset-password',
        '/v1/auth/reset-password-state',
        '/v1/onboarding/first-deploy',
        '/v1/onboarding/first-deploy/*',
        '/v1/organizations/settings',
        '/v1/resource-backups/*',
        '/v1/sources',
        '/v1/sources/*',
        '/v1/variable-groups',
        '/v1/variable-groups/*',
      ]),
    );
    expect(publicPathMatchers).not.toContain('/v1');
    expect(publicPathMatchers).not.toContain('/v1/audit');
    expect(publicPathMatchers).not.toContain('/v1/auth');
    expect(publicPathMatchers).not.toContain('/orgs');
    expect(publicPathMatchers).not.toContain('/v1/resource-backups');
    expect(renderedCaddyfile).not.toContain('/healthz');
    expect(renderedCaddyfile).not.toContain('/readyz');
    expect(renderedCaddyfile).not.toContain('/v1/nodes/register');
    expect(renderedCaddyfile).toContain('respond 404');
  });

  it('allow-lists only documented public control-plane paths in managed mode', (): void => {
    const renderedCaddyfile: string = renderCaddyfile('managed');

    expect(renderedCaddyfile).toContain(`@compartment_public_paths path ${renderCompartmentPublicPathMatchers()}`);
    expect(renderedCaddyfile).toContain('handle @compartment_host {');
    expect(renderedCaddyfile).toContain('respond 404');
    expect(renderedCaddyfile).not.toContain('/healthz');
    expect(renderedCaddyfile).not.toContain('/readyz');
    expect(renderedCaddyfile).not.toContain('/v1/nodes/register');
  });

  it('preserves the public app host for edge authorization checks', (): void => {
    const renderedCaddyfile: string = renderCaddyfile('internal');

    expect(renderedCaddyfile).toContain('header_up Host {host}');
  });

  it('strips platform-owned app auth cookies before proxying to tenant apps', (): void => {
    const renderedCaddyfile: string = renderCaddyfile('internal');
    const hostedAppProxyBlocks: string[] = readHostedAppProxyBlocks(renderedCaddyfile);

    expect(hostedAppProxyBlocks).toHaveLength(2);

    for (const block of hostedAppProxyBlocks) {
      for (const directive of readCaddyPlatformAppCookieStripDirectives()) {
        expect(block).toContain(directive);
      }
    }
  });

  it('strips platform-owned app auth cookies across middle, boundary, and all-platform layouts', (): void => {
    const testCases: readonly PlatformCookieStripTestCase[] = [
      {
        cookieHeader:
          'tenant=1; __Host-compartment_app_session=session-token; __Host-compartment_app_flow_flow-a=flow-a; __Host-compartment_app_flow_flow-b=flow-b; theme=dark',
        expectedCookieHeader: 'tenant=1; theme=dark',
      },
      {
        cookieHeader: '__Host-compartment_app_session=session-token; theme=dark',
        expectedCookieHeader: 'theme=dark',
      },
      {
        cookieHeader:
          'theme=dark; __Host-compartment_app_session=session-token; __Host-compartment_app_flow_flow-a=flow-a',
        expectedCookieHeader: 'theme=dark',
      },
      {
        cookieHeader: '__Host-compartment_app_session=session-token; __Host-compartment_app_flow_flow-a=flow-a',
        expectedCookieHeader: '',
      },
      {
        cookieHeader: 'theme=dark; compartment_app_flow_flow-a=legacy-flow',
        expectedCookieHeader: 'theme=dark',
      },
      {
        cookieHeader: 'theme=dark; compartment_app_session=legacy-session-token',
        expectedCookieHeader: 'theme=dark',
      },
      {
        cookieHeader: 'compartment_app_session=legacy-session-token; __Host-compartment_app_session=session-token',
        expectedCookieHeader: '',
      },
      {
        cookieHeader: 'tenant=1; compartment_session=legacy-console-session; theme=dark',
        expectedCookieHeader: 'tenant=1; theme=dark',
      },
      {
        cookieHeader: 'tenant=1; __Host-compartment_pwd_reset_token=reset-token; theme=dark',
        expectedCookieHeader: 'tenant=1; theme=dark',
      },
    ];

    for (const testCase of testCases) {
      expect(applyPlatformAppCookieStripDirectives(testCase.cookieHeader)).toBe(testCase.expectedCookieHeader);
    }
  });

  it('uses broker DNS-01 for a single managed wildcard TLS ingress and redirects HTTP', (): void => {
    const renderedCaddyfile: string = renderCaddyfile('managed');

    expect(renderedCaddyfile).toContain('http://*.{$COMPARTMENT_BASE_DOMAIN}:{$COMPARTMENT_CADDY_HTTP_PORT} {');
    expect(renderedCaddyfile).toContain('redir https://{host}:{$COMPARTMENT_PUBLIC_HTTPS_PORT}{uri} permanent');
    expect(renderedCaddyfile).toContain('https://*.{$COMPARTMENT_BASE_DOMAIN}:{$COMPARTMENT_CADDY_HTTPS_PORT} {');
    expect(renderedCaddyfile).toContain('issuer {$COMPARTMENT_ACME_ISSUER} {$COMPARTMENT_ACME_CA_URL} {');
    expect(renderedCaddyfile).toContain('email {$COMPARTMENT_ACME_EMAIL}');
    expect(renderedCaddyfile).toContain('dns compartment_broker {');
    expect(renderedCaddyfile).toContain('broker_url {$COMPARTMENT_MANAGED_DOMAIN_BROKER_URL}');
    expect(renderedCaddyfile).toContain('token {$COMPARTMENT_MANAGED_DOMAIN_BROKER_TOKEN}');
    expect(renderedCaddyfile).toContain('propagation_timeout 5m');
    expect(renderedCaddyfile).toContain('resolvers 1.1.1.1 8.8.8.8');
    expect(renderedCaddyfile).toContain('@compartment_host host console.{$COMPARTMENT_BASE_DOMAIN}');
    expect(renderedCaddyfile).toContain('on_demand_tls {');
    expect(renderedCaddyfile).toContain(
      'ask http://{$COMPARTMENT_EDGE_INTERNAL_HOST}:{$COMPARTMENT_EDGE_PORT}/internal/tls/ask',
    );
    expect(renderedCaddyfile).toContain('http://:{$COMPARTMENT_CADDY_HTTP_PORT} {');
    expect(renderedCaddyfile).toContain('https://:{$COMPARTMENT_CADDY_HTTPS_PORT} {');
    expect(renderedCaddyfile).toContain('issuer {$COMPARTMENT_ACME_ISSUER} {$COMPARTMENT_ACME_CA_URL} {');
    expect(renderedCaddyfile).toContain('on_demand');
    expect(renderedCaddyfile).not.toContain('tls internal');
    expect(renderedCaddyfile).not.toContain('*.apps.');
    expect(renderedCaddyfile).not.toContain('acme-v02.api.letsencrypt.org');
  });

  it('uses plain HTTP origin ingress for custom domains with external TLS', (): void => {
    const renderedCaddyfile: string = renderCaddyfile('custom-http');

    expect(renderedCaddyfile).toContain('http://*.{$COMPARTMENT_BASE_DOMAIN}:{$COMPARTMENT_CADDY_HTTP_PORT} {');
    expect(renderedCaddyfile).toContain('@compartment_host host console.{$COMPARTMENT_BASE_DOMAIN}');
    expect(renderedCaddyfile).toContain('reverse_proxy {$COMPARTMENT_API_INTERNAL_HOST}:{$COMPARTMENT_API_PORT}');
    expect(renderedCaddyfile).not.toContain('tls internal');
    expect(renderedCaddyfile).not.toContain('issuer {$COMPARTMENT_ACME_ISSUER}');
    expect(renderedCaddyfile).not.toContain('on_demand_tls');
    expect(renderedCaddyfile).not.toContain('redir https://');
    expect(renderedCaddyfile).not.toContain('http://console.{$COMPARTMENT_BASE_DOMAIN}');
    expect(renderedCaddyfile).not.toContain('*.apps.');
  });

  it('uses provided certificate files for custom certificate ingress', (): void => {
    const renderedCaddyfile: string = renderCaddyfile('custom-cert');

    expect(renderedCaddyfile).toContain('http://*.{$COMPARTMENT_BASE_DOMAIN}:{$COMPARTMENT_CADDY_HTTP_PORT} {');
    expect(renderedCaddyfile).toContain('https://*.{$COMPARTMENT_BASE_DOMAIN}:{$COMPARTMENT_CADDY_HTTPS_PORT} {');
    expect(renderedCaddyfile).toContain('@compartment_host host console.{$COMPARTMENT_BASE_DOMAIN}');
    expect(renderedCaddyfile).toContain('tls {$COMPARTMENT_CUSTOM_TLS_CERT_FILE} {$COMPARTMENT_CUSTOM_TLS_KEY_FILE}');
    expect(renderedCaddyfile).toContain('on_demand_tls {');
    expect(renderedCaddyfile).toContain('http://:{$COMPARTMENT_CADDY_HTTP_PORT} {');
    expect(renderedCaddyfile).toContain('https://:{$COMPARTMENT_CADDY_HTTPS_PORT} {');
    expect(renderedCaddyfile).toContain('issuer {$COMPARTMENT_ACME_ISSUER} {$COMPARTMENT_ACME_CA_URL} {');
    expect(renderedCaddyfile).toContain('email {$COMPARTMENT_ACME_EMAIL}');
    expect(renderedCaddyfile).toContain('on_demand');
    expect(renderedCaddyfile).toContain('redir https://{host}:{$COMPARTMENT_PUBLIC_HTTPS_PORT}{uri} permanent');
    expect(renderedCaddyfile).not.toContain('tls internal');
    expect(renderedCaddyfile).not.toContain('http://console.{$COMPARTMENT_BASE_DOMAIN}');
    expect(renderedCaddyfile).not.toContain('https://console.{$COMPARTMENT_BASE_DOMAIN}');
  });
});

function renderCaddyfile(mode: 'custom-cert' | 'custom-http' | 'internal' | 'managed'): string {
  return execFileSync(process.execPath, [syncCaddyfileScriptPath, '--stdout', '--mode', mode], {
    cwd: edgePackageRoot,
    encoding: 'utf8',
  });
}

function renderCompartmentPublicPathMatchers(): string {
  return [
    ...edgePublicControlPlaneExactPathnames,
    ...edgePublicControlPlanePrefixPathnames.flatMap((pathname: string): string[] => [pathname, `${pathname}/*`]),
    ...edgePublicControlPlaneNestedPrefixPathnames.map((pathname: string): string => `${pathname}/*`),
  ].join(' ');
}

function readHostedAppProxyBlocks(renderedCaddyfile: string): string[] {
  return Array.from(
    renderedCaddyfile.matchAll(
      /reverse_proxy \{header\.X-Compartment-Upstream-Host\}:\{header\.X-Compartment-Upstream-Port\} \{[\s\S]*?header_up -X-Compartment-Upstream-Port\n\t\t\}/gu,
    ),
    (match: RegExpMatchArray): string => match[0],
  );
}

function applyPlatformAppCookieStripDirectives(cookieHeader: string): string {
  return readCaddyPlatformAppCookieStripDirectives().reduce((currentHeaderValue: string, directive: string): string => {
    const match: RegExpExecArray | null = /^header_up Cookie "(.*)" "(.*)"$/u.exec(directive);
    if (match === null) {
      return currentHeaderValue;
    }
    const [, pattern = '', replacement = ''] = match;

    return currentHeaderValue.replaceAll(new RegExp(pattern, 'g'), replacement);
  }, cookieHeader);
}
