import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  compartmentIngressAuthorizePathname,
  compartmentIngressRoutePathname,
  compartmentIngressRouteResolvedHeaderName,
  compartmentProxyPathHeaderName,
  compartmentUpstreamHostHeaderName,
  compartmentUpstreamPortHeaderName,
} from '@compartment/contracts';
import { readCaddyPlatformAppCookieStripDirectives } from '../src/services/edge-caddy-cookie-strip.service';
import {
  edgePublicControlPlaneExactPathnames,
  edgePublicControlPlaneNestedPrefixPathnames,
  edgePublicControlPlanePrefixPathnames,
} from '../src/edge-public-control-plane-paths';
import type {
  CaddyAdaptedConfig,
  CaddyCookieReplacement,
  CaddyCommandResult,
  CaddyHandler,
  CaddyHandlerLocation,
  CaddyHeaderReplacement,
  CaddyServerConfig,
  CaddyValidationSetup,
  WorkflowJob,
  WorkflowStep,
} from './caddy-config.types';
import {
  adaptCaddyfile,
  collectCaddyHandlers,
  readCaddyValidationSetup,
  readCaddyfileEnvironmentPlaceholders,
  readChartCaddyEnvironment,
  readChartCaddyEnvironmentValue,
  readDeletedRequestHeaders,
  readSingleCaddyServer,
  readWorkflowJob,
  validateCaddyfile,
} from './caddy-config.utils';

const repositoryRoot: string = resolve(__dirname, '../../..');
const edgePackageRoot: string = resolve(repositoryRoot, 'packages/edge');
const caddyfilePath: string = resolve(edgePackageRoot, 'Caddyfile');
const syncCaddyfileScriptPath: string = resolve(edgePackageRoot, 'scripts/sync-caddyfile.mjs');
const ciWorkflowPath: string = resolve(repositoryRoot, '.github/workflows/ci.yml');
const mainCiWorkflowPath: string = resolve(repositoryRoot, '.github/workflows/main-ci.yml');
const caddyValidationJobName: string = 'edge-caddy-config';
const pinnedHelmActionPath: string = './.github/actions/install-pinned-helm';
/** The image copies this file into /etc/caddy/Caddyfile, so every behavioral assertion reads it from disk. */
const committedCaddyfile: string = readFileSync(caddyfilePath, 'utf8');
const caddyValidation: CaddyValidationSetup = readCaddyValidationSetup();

describe('edge Caddyfile source', (): void => {
  it('matches the committed generated file', (): void => {
    expect(committedCaddyfile).toBe(renderCaddyfile());
  });
});

describe('edge Caddyfile validation gate', (): void => {
  it.each([
    { workflowName: 'ci.yml', workflowPath: ciWorkflowPath },
    { workflowName: 'main-ci.yml', workflowPath: mainCiWorkflowPath },
  ])('runs as a job that cannot silently skip in $workflowName', ({ workflowPath }): void => {
    const job: WorkflowJob = readWorkflowJob(workflowPath, caddyValidationJobName);
    const stepUses: (string | undefined)[] = job.steps.map((step: WorkflowStep): string | undefined => step.uses);
    const stepRuns: string[] = job.steps.map((step: WorkflowStep): string => step.run ?? '');

    // Without the required flag a missing Caddy build or Helm would skip the suite instead of failing.
    expect(job.env?.COMPARTMENT_CADDY_VALIDATION_REQUIRED).toBe('1');
    expect(job.env?.COMPARTMENT_CADDY_VALIDATION_IMAGE).toContain('compartment-caddy:sha-');
    expect(stepUses).toContain(pinnedHelmActionPath);
    expect(stepRuns).toContain('pnpm --filter @compartment/edge test:caddy-config');
  });

  it('keeps the gate in the aggregate check:ci result', (): void => {
    const aggregateJob: WorkflowJob = readWorkflowJob(ciWorkflowPath, 'check-ci');
    const [verificationStep]: WorkflowStep[] = aggregateJob.steps;

    expect(aggregateJob.needs).toContain(caddyValidationJobName);
    expect(verificationStep?.run).toContain(`needs.${caddyValidationJobName}.result`);
  });
});

describe.skipIf(caddyValidation.image === undefined || !caddyValidation.helmAvailable)(
  'committed edge Caddyfile adapted by the shipped Caddy build',
  (): void => {
    it('only reads environment variables the rendered chart gives the Caddy container', (): void => {
      const placeholders: string[] = readCaddyfileEnvironmentPlaceholders(committedCaddyfile);
      const renderedEnvironmentNames: string[] = Object.keys(readChartCaddyEnvironment());

      expect(placeholders.length).toBeGreaterThan(0);
      for (const placeholder of placeholders) {
        expect(renderedEnvironmentNames).toContain(placeholder);
      }
    });

    it('validates against the Caddy build that carries the Compartment plugins', (): void => {
      const result: CaddyCommandResult = validateCaddyfile(committedCaddyfile);

      expect(result.exitCode, result.stderr).toBe(0);
      expect(`${result.stdout}${result.stderr}`).toContain('Valid configuration');
    });

    it('derives the client IP only from a strictly trusted private ingress hop', (): void => {
      const server: CaddyServerConfig = readAdaptedServer();
      const locations: CaddyHandlerLocation[] = collectCaddyHandlers(server);
      const deletedRequestHeaders: string[] = locations.flatMap((location: CaddyHandlerLocation): string[] =>
        readDeletedRequestHeaders(location.handler),
      );

      const trustedRanges: string[] = server.trusted_proxies?.ranges ?? [];

      expect(server.trusted_proxies?.source).toBe('static');
      expect(trustedRanges.length).toBeGreaterThan(0);
      expect(trustedRanges.filter(isPrivateRange)).toStrictEqual(trustedRanges);
      // Caddy encodes the strict flag as 1; anything else means untrusted hops keep their forwarded IP.
      expect(server.trusted_proxies_strict).toBe(1);
      expect(server.client_ip_headers).toStrictEqual(['X-Forwarded-For']);
      expect(deletedRequestHeaders).toStrictEqual(
        expect.arrayContaining(['Forwarded', 'X-Forwarded-For', 'X-Forwarded-Host', 'X-Forwarded-Proto']),
      );
      expect(readLastForwardedHeaderScrubOrder(locations)).toBeLessThan(readHandlerOrder(locations, 'reverse_proxy'));
    });

    it('serves plain HTTP on the chart port and never issues certificates', (): void => {
      const config: CaddyAdaptedConfig = adaptCaddyfile(committedCaddyfile);
      const server: CaddyServerConfig = readAdaptedServer();

      expect(Object.keys(config.apps)).toStrictEqual(['http']);
      expect(server.automatic_https?.disable).toBe(true);
      expect(server.listen).toStrictEqual([`:${readChartCaddyEnvironmentValue('COMPARTMENT_CADDY_HTTP_PORT')}`]);
      expect(config.apps.http.metrics).toBeDefined();
      expect(JSON.stringify(config)).not.toContain('on_demand');
      expect(JSON.stringify(config)).not.toContain('issuer');
    });

    it('rebuilds forwarded metadata from trusted values for every upstream', (): void => {
      const locations: CaddyHandlerLocation[] = collectCaddyHandlers(readAdaptedServer());
      const proxies: CaddyHandler[] = readHandlers(locations, 'reverse_proxy');
      const httpsScheme: CaddyHandlerLocation | undefined = locations.find(
        (location: CaddyHandlerLocation): boolean =>
          location.handler.handler === 'vars' && location.handler.public_scheme === 'https',
      );

      expect(proxies.length).toBeGreaterThan(0);
      for (const proxy of proxies) {
        expect(proxy.headers?.request?.set?.['X-Forwarded-For']).toStrictEqual(['{http.vars.client_ip}']);
        expect(proxy.headers?.request?.set?.['X-Forwarded-Proto']).toStrictEqual(['{http.vars.public_scheme}']);
        expect(proxy.headers?.request?.set?.['X-Forwarded-Host']).toStrictEqual(['{http.request.host}']);
      }
      expect(httpsScheme?.matchers).toStrictEqual([{ header: { 'X-Forwarded-Proto': ['https'] } }]);
    });

    it('allow-lists public control-plane paths on the console host and rejects the rest', (): void => {
      const locations: CaddyHandlerLocation[] = collectCaddyHandlers(readAdaptedServer());
      const consoleLocations: CaddyHandlerLocation[] = readHostLocations(locations, readConsoleHost());
      const consoleProxies: CaddyHandlerLocation[] = consoleLocations.filter(
        (location: CaddyHandlerLocation): boolean => location.handler.handler === 'reverse_proxy',
      );
      // A second proxy on the console host would reach the control plane without the allow-list above it.
      const consoleProxy: CaddyHandlerLocation = readOnlyLocation(consoleProxies, 'console host reverse_proxy');
      const allowedPaths: string[] = consoleProxy.matchers.flatMap((matcher): string[] => matcher.path ?? []);

      expect(consoleProxies).toHaveLength(1);
      expect(allowedPaths).toStrictEqual(readCompartmentPublicPathMatchers());
      expect(allowedPaths.some((path: string): boolean => path.startsWith('/internal'))).toBe(false);
      expect(consoleProxy.handler.upstreams).toStrictEqual([{ dial: readApiUpstream() }]);
      expect(readHandlers(consoleLocations, 'compartment_rate_limit')).toStrictEqual([]);
      expect(readHandlers(consoleLocations, 'compartment_traffic_meter')).toStrictEqual([]);
      expect(readHandlers(consoleLocations, 'static_response').map(readStatusCode)).toStrictEqual([404]);
    });

    it('resolves, meters, limits and authorizes hosted application requests in that order', (): void => {
      const locations: CaddyHandlerLocation[] = collectCaddyHandlers(readAdaptedServer());
      const applicationLocations: CaddyHandlerLocation[] = readHostLocations(locations, readApplicationHost());
      const [meter]: CaddyHandler[] = readHandlers(applicationLocations, 'compartment_traffic_meter');
      const [rateLimit]: CaddyHandler[] = readHandlers(applicationLocations, 'compartment_rate_limit');

      // Attribution has to be resolved before metering, and both before the request reaches a tenant.
      const pipelineOrders: number[] = [
        readIdentityHeaderScrubOrder(applicationLocations),
        readForwardAuthOrder(applicationLocations, compartmentIngressRoutePathname),
        readHandlerOrder(applicationLocations, 'compartment_traffic_meter'),
        readHandlerOrder(applicationLocations, 'compartment_rate_limit'),
        readForwardAuthOrder(applicationLocations, compartmentIngressAuthorizePathname),
        readUpstreamProxy(applicationLocations).order,
      ];

      expect(readHandlers(applicationLocations, 'compartment_traffic_meter')).toHaveLength(1);
      expect(readHandlers(applicationLocations, 'compartment_rate_limit')).toHaveLength(1);
      expect(pipelineOrders).toStrictEqual([...pipelineOrders].sort(compareOrders));
      expect(meter?.api_url).toBe(`http://${readApiUpstream()}`);
      expect(meter?.edge_token).toBe(readChartCaddyEnvironmentValue('COMPARTMENT_EDGE_TOKEN'));
      // Caddy durations are nanoseconds, so the chart's millisecond value must survive the conversion.
      expect(meter?.flush_interval).toBe(
        Number(readChartCaddyEnvironmentValue('COMPARTMENT_USAGE_METERING_INTERVAL_MS')) * 1_000_000,
      );
      expect(rateLimit?.app_requests_per_second).toBe(
        Number(readChartCaddyEnvironmentValue('COMPARTMENT_EDGE_APP_REQUESTS_PER_SECOND')),
      );
      expect(rateLimit?.app_burst).toBe(Number(readChartCaddyEnvironmentValue('COMPARTMENT_EDGE_APP_BURST')));
      expect(rateLimit?.app_in_flight).toBe(Number(readChartCaddyEnvironmentValue('COMPARTMENT_EDGE_APP_IN_FLIGHT')));
      expect(rateLimit?.client_requests_per_second).toBe(
        Number(readChartCaddyEnvironmentValue('COMPARTMENT_EDGE_CLIENT_REQUESTS_PER_SECOND')),
      );
      expect(rateLimit?.client_burst).toBe(Number(readChartCaddyEnvironmentValue('COMPARTMENT_EDGE_CLIENT_BURST')));
    });

    it('hides platform-owned headers and cookies from tenant applications', (): void => {
      const locations: CaddyHandlerLocation[] = collectCaddyHandlers(readAdaptedServer());
      const applicationLocations: CaddyHandlerLocation[] = readHostLocations(locations, readApplicationHost());
      const upstreamProxy: CaddyHandler = readUpstreamProxy(applicationLocations).handler;
      const requestReplacements: CaddyHeaderReplacement[] = upstreamProxy.headers?.request?.replace?.Cookie ?? [];
      const responseReplacements: CaddyHeaderReplacement[] =
        upstreamProxy.headers?.response?.replace?.['Set-Cookie'] ?? [];

      expect(upstreamProxy.headers?.request?.delete).toStrictEqual([
        compartmentIngressRouteResolvedHeaderName,
        compartmentProxyPathHeaderName,
        compartmentUpstreamHostHeaderName,
        compartmentUpstreamPortHeaderName,
      ]);
      // Comparing every pattern, not just the count, keeps a duplicated rewrite from hiding a lost one.
      expect(requestReplacements.map(readAdaptedReplacement)).toStrictEqual(
        readCookieStripReplacements('header_up Cookie'),
      );
      expect(responseReplacements.map(readAdaptedReplacement)).toStrictEqual(
        readCookieStripReplacements('header_down Set-Cookie'),
      );
    });
  },
);

function renderCaddyfile(): string {
  return execFileSync(process.execPath, [syncCaddyfileScriptPath, '--stdout'], {
    cwd: edgePackageRoot,
    encoding: 'utf8',
  });
}

function readConsoleHost(): string {
  return `console.${readChartCaddyEnvironmentValue('COMPARTMENT_BASE_DOMAIN')}`;
}

function readApplicationHost(): string {
  return `*.${readChartCaddyEnvironmentValue('COMPARTMENT_BASE_DOMAIN')}`;
}

function readApiUpstream(): string {
  return `${readChartCaddyEnvironmentValue('COMPARTMENT_API_INTERNAL_HOST')}:${readChartCaddyEnvironmentValue('COMPARTMENT_API_PORT')}`;
}

function readOnlyLocation(locations: CaddyHandlerLocation[], description: string): CaddyHandlerLocation {
  const [location]: CaddyHandlerLocation[] = locations;
  if (locations.length !== 1 || location === undefined) {
    throw new Error(`Expected exactly one ${description}, found ${locations.length}.`);
  }

  return location;
}

/** Directives read `header_up Cookie "<search>" "<replace>"`, which adapts into one replacement entry. */
function readCookieStripReplacements(directivePrefix: string): CaddyCookieReplacement[] {
  return readCaddyPlatformAppCookieStripDirectives()
    .filter((directive: string): boolean => directive.startsWith(directivePrefix))
    .map((directive: string): CaddyCookieReplacement => {
      const quotedArguments: string[] = [...directive.matchAll(/"(?<argument>[^"]*)"/gu)].map(
        (match: RegExpExecArray): string => match.groups?.argument ?? '',
      );

      return { replace: quotedArguments[1] ?? '', searchRegexp: quotedArguments[0] ?? '' };
    });
}

function readAdaptedReplacement(replacement: CaddyHeaderReplacement): CaddyCookieReplacement {
  return { replace: replacement.replace ?? '', searchRegexp: replacement.search_regexp ?? '' };
}

function readAdaptedServer(): CaddyServerConfig {
  return readSingleCaddyServer(adaptCaddyfile(committedCaddyfile));
}

function readCompartmentPublicPathMatchers(): string[] {
  return [
    ...edgePublicControlPlaneExactPathnames,
    ...edgePublicControlPlanePrefixPathnames.flatMap((pathname: string): string[] => [pathname, `${pathname}/*`]),
    ...edgePublicControlPlaneNestedPrefixPathnames.map((pathname: string): string => `${pathname}/*`),
  ];
}

function readHostLocations(locations: CaddyHandlerLocation[], host: string): CaddyHandlerLocation[] {
  return locations.filter((location: CaddyHandlerLocation): boolean => location.hosts.includes(host));
}

function readHandlers(locations: CaddyHandlerLocation[], handlerName: string): CaddyHandler[] {
  return locations
    .filter((location: CaddyHandlerLocation): boolean => location.handler.handler === handlerName)
    .map((location: CaddyHandlerLocation): CaddyHandler => location.handler);
}

function readHandlerOrder(locations: CaddyHandlerLocation[], handlerName: string): number {
  const location: CaddyHandlerLocation | undefined = locations.find(
    (candidate: CaddyHandlerLocation): boolean => candidate.handler.handler === handlerName,
  );
  if (location === undefined) {
    throw new Error(`Adapted configuration has no ${handlerName} handler on the hosted application host.`);
  }

  return location.order;
}

function readForwardAuthOrder(locations: CaddyHandlerLocation[], uri: string): number {
  const location: CaddyHandlerLocation | undefined = locations.find(
    (candidate: CaddyHandlerLocation): boolean => candidate.handler.rewrite?.uri === uri,
  );
  if (location === undefined) {
    throw new Error(`Adapted configuration has no forward_auth hop for ${uri}.`);
  }

  return location.order;
}

function readUpstreamProxy(locations: CaddyHandlerLocation[]): CaddyHandlerLocation {
  const dial: string = `{http.request.header.${compartmentUpstreamHostHeaderName}}:{http.request.header.${compartmentUpstreamPortHeaderName}}`;
  const location: CaddyHandlerLocation | undefined = locations.find(
    (candidate: CaddyHandlerLocation): boolean => candidate.handler.upstreams?.[0]?.dial === dial,
  );
  if (location === undefined) {
    throw new Error('Adapted configuration never proxies to the resolved tenant upstream.');
  }

  return location;
}

function readLastForwardedHeaderScrubOrder(locations: CaddyHandlerLocation[]): number {
  const scrubOrders: number[] = locations
    .filter((location: CaddyHandlerLocation): boolean =>
      readDeletedRequestHeaders(location.handler).some((headerName: string): boolean =>
        headerName.startsWith('X-Forwarded-'),
      ),
    )
    .map((location: CaddyHandlerLocation): number => location.order);

  return Math.max(...scrubOrders);
}

function readIdentityHeaderScrubOrder(locations: CaddyHandlerLocation[]): number {
  const location: CaddyHandlerLocation | undefined = locations.find((candidate: CaddyHandlerLocation): boolean =>
    readDeletedRequestHeaders(candidate.handler).includes('X-Compartment-*'),
  );
  if (location === undefined) {
    throw new Error('Hosted application requests keep inbound X-Compartment-* headers.');
  }

  return location.order;
}

/** Trust may only reach loopback and private space; a public range here would accept spoofed hops. */
function isPrivateRange(range: string): boolean {
  return /^(?:10\.|127\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.|192\.168\.|fd|fe80:|::1$)/iu.test(range);
}

function compareOrders(left: number, right: number): number {
  return left - right;
}

function readStatusCode(handler: CaddyHandler): number | undefined {
  return handler.status_code;
}
