import { resolve4, resolve6, resolveCname } from 'node:dns/promises';
import {
  buildControlPlaneHost,
  buildDomainProbeHost,
  compartmentDomainProbePathname,
  type DomainHostPlan,
} from '@compartment/contracts';
import type { ApiConfig } from '../config';
import type {
  ActiveDomainProbeInput,
  DomainCheckFailure,
  DomainCheckResult,
} from './system-domain-check.service.types';
import { fetchSystemDomainProbeHttp } from './outbound-http.service';

const activeProbeOperationId: string = 'active';
const probeTimeoutMs: number = 5_000;

export async function checkDomainDns(hostPlan: DomainHostPlan): Promise<DomainCheckResult> {
  const hostnames: string[] = [buildControlPlaneHost(hostPlan.baseDomain), buildDomainProbeHost(hostPlan.baseDomain)];

  for (const hostname of hostnames) {
    const failure: DomainCheckFailure | null = await checkResolvableHostname(hostname);
    if (failure !== null) {
      return { failure };
    }
  }

  return { failure: null };
}

export async function checkActiveDomainProbe(input: ActiveDomainProbeInput): Promise<DomainCheckResult> {
  const url: string = buildDomainProbeUrl(input.hostPlan, input.config, activeProbeOperationId);

  try {
    return readProbeResponseResult(await fetchDomainProbe(url), url);
  } catch (error) {
    return readProbeErrorResult(error instanceof Error ? error : new Error('unknown error'), url);
  }
}

export function isActiveDomainProbeOperation(operationId: string): boolean {
  return operationId === activeProbeOperationId;
}

async function checkResolvableHostname(hostname: string): Promise<DomainCheckFailure | null> {
  const results: PromiseSettledResult<string[]>[] = await Promise.allSettled([
    resolve4(hostname),
    resolve6(hostname),
    resolveCname(hostname),
  ]);
  if (results.some(isFulfilledLookup)) {
    return null;
  }

  return {
    code: 'dns_unresolved',
    message: `DNS has no public A, AAAA, or CNAME answer for ${hostname}.`,
  };
}

function isFulfilledLookup(result: PromiseSettledResult<string[]>): boolean {
  return result.status === 'fulfilled';
}

async function fetchDomainProbe(url: string): Promise<Response> {
  return await fetchSystemDomainProbeHttp(url, {
    headers: {
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(probeTimeoutMs),
  });
}

function readProbeResponseResult(response: Response, url: string): DomainCheckResult {
  void response.body?.cancel();
  if (response.ok) {
    return { failure: null };
  }

  return {
    failure: {
      code: 'probe_failed',
      message: `Domain probe returned HTTP ${response.status.toString()} for ${url}.`,
    },
  };
}

function readProbeErrorResult(error: Error, url: string): DomainCheckResult {
  return {
    failure: {
      code: 'probe_unreachable',
      message: `Domain probe could not reach ${url}: ${error.message}.`,
    },
  };
}

function buildDomainProbeUrl(hostPlan: DomainHostPlan, config: ApiConfig, operationId: string): string {
  const port: number = readPublicProbePort(hostPlan.publicScheme, config);
  const portSuffix: string = readPublicProbePortSuffix(hostPlan.publicScheme, port);
  return `${hostPlan.publicScheme}://${buildControlPlaneHost(hostPlan.baseDomain)}${portSuffix}${compartmentDomainProbePathname}/${operationId}`;
}

function readPublicProbePort(protocol: 'http' | 'https', config: ApiConfig): number {
  return protocol === 'http' ? config.publicHttpPort : config.publicHttpsPort;
}

function readPublicProbePortSuffix(protocol: 'http' | 'https', port: number): string {
  if ((protocol === 'http' && port === 80) || (protocol === 'https' && port === 443)) {
    return '';
  }

  return `:${port.toString()}`;
}
