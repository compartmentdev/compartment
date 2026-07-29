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
const caddyfilePath: string = resolve(edgePackageRoot, 'Caddyfile');
const syncCaddyfileScriptPath: string = resolve(edgePackageRoot, 'scripts/sync-caddyfile.mjs');

describe('edge Caddyfile', (): void => {
  it('has one generated internal HTTP transport profile', (): void => {
    const renderedCaddyfile: string = renderCaddyfile();

    expect(readFileSync(caddyfilePath, 'utf8')).toBe(renderedCaddyfile);
    expect(renderedCaddyfile).toContain(':{$COMPARTMENT_CADDY_HTTP_PORT} {');
    expect(renderedCaddyfile).toContain('auto_https off');
    expect(renderedCaddyfile).not.toMatch(/\btls\b/u);
    expect(renderedCaddyfile).not.toContain('https://');
    expect(renderedCaddyfile).not.toContain('on_demand');
    expect(renderedCaddyfile).not.toContain('issuer');
    expect(renderedCaddyfile).not.toContain('COMPARTMENT_MANAGED_DOMAIN_BROKER');
  });

  it('trusts forwarded metadata only through the private ingress hop and reconstructs proxy headers', (): void => {
    const renderedCaddyfile: string = renderCaddyfile();

    expect(renderedCaddyfile).toContain('trusted_proxies static private_ranges');
    expect(renderedCaddyfile).toContain('trusted_proxies_strict');
    expect(renderedCaddyfile).toContain('client_ip_headers X-Forwarded-For');
    expect(renderedCaddyfile).toContain('header_up X-Forwarded-Host {host}');
    expect(renderedCaddyfile).toContain('vars public_scheme http');
    expect(renderedCaddyfile).toContain('@ingress_https header X-Forwarded-Proto https');
    expect(renderedCaddyfile).toContain('header_up X-Forwarded-Proto {vars.public_scheme}');
    expect(renderedCaddyfile).toContain('header_up X-Forwarded-For {client_ip}');
    expect(renderedCaddyfile).toContain('request_header -X-Forwarded-Host');
    expect(renderedCaddyfile).toContain('request_header -X-Forwarded-Proto');
    expect(renderedCaddyfile).toContain('request_header -X-Forwarded-For');
    expect(renderedCaddyfile).not.toContain('header_up X-Forwarded-Host {header.X-Forwarded-Host}');
    expect(renderedCaddyfile).not.toContain('header_up X-Forwarded-Proto {header.X-Forwarded-Proto}');
    expect(renderedCaddyfile).not.toContain('header_up X-Forwarded-For {header.X-Forwarded-For}');
  });

  it('keeps the Edge authorization gate on every hosted application request', (): void => {
    const renderedCaddyfile: string = renderCaddyfile();

    expect(renderedCaddyfile).toContain('@application_host host *.{$COMPARTMENT_BASE_DOMAIN}');
    expect(renderedCaddyfile).toContain('forward_auth {$COMPARTMENT_EDGE_INTERNAL_HOST}:{$COMPARTMENT_EDGE_PORT}');
    expect(renderedCaddyfile).toContain('uri /internal/ingress/authorize');
    expect(renderedCaddyfile).toContain('header_up Host {host}');
  });

  it('allow-lists public control-plane routes and denies internal and operator surfaces', (): void => {
    const renderedCaddyfile: string = renderCaddyfile();
    const publicPathMatchers: string[] = renderCompartmentPublicPathMatchers().split(' ');

    expect(renderedCaddyfile).toContain(`@compartment_public_paths path ${renderCompartmentPublicPathMatchers()}`);
    expect(publicPathMatchers).toContain('/v1/auth/login');
    expect(publicPathMatchers).toContain('/v1/projects/*');
    expect(publicPathMatchers).not.toContain('/internal/*');
    expect(renderedCaddyfile).not.toContain('/healthz');
    expect(renderedCaddyfile).not.toContain('/readyz');
    expect(renderedCaddyfile).not.toContain('/v1/nodes/register');
    expect(renderedCaddyfile).not.toContain('/v2/');
    expect(renderedCaddyfile).not.toContain('1234');
    expect(renderedCaddyfile).toContain('respond 404');
  });

  it('strips platform-owned cookies before proxying to tenant applications', (): void => {
    const renderedCaddyfile: string = renderCaddyfile();

    for (const directive of readCaddyPlatformAppCookieStripDirectives()) {
      expect(renderedCaddyfile).toContain(directive);
    }
  });
});

function renderCaddyfile(): string {
  return execFileSync(process.execPath, [syncCaddyfileScriptPath, '--stdout'], {
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
