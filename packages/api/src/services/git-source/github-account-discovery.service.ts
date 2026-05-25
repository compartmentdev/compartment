import type {
  GitHubAccountDiscoveryResultRequest,
  GitHubAccountDiscoveryResultResponse,
  GitHubAccountDiscoveryStartRequest,
  GitHubAccountDiscoveryStartResponse,
} from '@compartment/contracts';
import { readUrlOrigin } from '@compartment/utils';
import { createGitSourceRegistrationFailedError } from '../../errors/api-business-error';
import { getApiConfig } from '../../runtime/runtime-access';
import { buildRuntimePublicSettings } from '../public-hosts.service';
import {
  readGitHubAccountDiscoveryBrokerResult,
  startGitHubAccountDiscoveryBrokerSession,
} from './github-account-discovery-broker.adapter';

export async function startGitHubAccountDiscovery(
  input: GitHubAccountDiscoveryStartRequest,
): Promise<GitHubAccountDiscoveryStartResponse> {
  assertRuntimeReturnTo(input.returnTo);
  return await startGitHubAccountDiscoveryBrokerSession(input);
}

export async function readGitHubAccountDiscoveryResult(
  input: GitHubAccountDiscoveryResultRequest,
): Promise<GitHubAccountDiscoveryResultResponse> {
  return await readGitHubAccountDiscoveryBrokerResult(input);
}

function assertRuntimeReturnTo(returnTo: string): void {
  const compartmentUrl: string = buildRuntimePublicSettings(getApiConfig()).compartmentUrl;
  if (readUrlOrigin(returnTo) === compartmentUrl) {
    return;
  }

  throw createGitSourceRegistrationFailedError('GitHub account discovery return URL does not belong to this install.');
}
