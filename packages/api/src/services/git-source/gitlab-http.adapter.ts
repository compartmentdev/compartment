import { buildGitLabApiBaseUrl } from '@compartment/utils';
import { createGitLabTrustedOutboundFetch } from '../outbound-http.service';
import type { GitLabClientInput, GitLabRequestInput } from './gitlab-http.adapter.types';

class GitLabHttpError extends Error {
  public constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'GitLabHttpError';
  }
}

export class GitLabHttpClient {
  private readonly baseUrl: string;
  private readonly fetch: typeof fetch;

  public constructor(private readonly input: GitLabClientInput) {
    this.baseUrl = buildGitLabApiBaseUrl(input.providerHost);
    this.fetch = createGitLabTrustedOutboundFetch();
  }

  public async request<T>(input: GitLabRequestInput): Promise<T> {
    const response: Response = await this.fetch(this.buildUrl(input), this.buildInit(input));
    if (!response.ok) {
      throw new GitLabHttpError(await readFailureMessage(response), response.status);
    }
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  public async requestPages<T>(input: GitLabRequestInput, pageCap: number): Promise<T[]> {
    const values: T[] = [];
    for (let page: number = 1; page <= pageCap; page += 1) {
      const response: Response = await this.fetch(
        this.buildUrl({ ...input, query: { ...input.query, page, per_page: 100 } }),
        this.buildInit(input),
      );
      if (!response.ok) throw new GitLabHttpError(await readFailureMessage(response), response.status);
      values.push(...((await response.json()) as T[]));
      if ((response.headers.get('x-next-page') ?? '').length === 0) return values;
    }
    throw new Error(`GitLab pagination exceeded the ${String(pageCap)} page safety cap for ${input.path}.`);
  }

  private buildUrl(input: GitLabRequestInput): URL {
    const url: URL = new URL(`${this.baseUrl}${input.path}`);
    for (const [key, value] of Object.entries(input.query ?? {})) url.searchParams.set(key, String(value));
    return url;
  }

  private buildInit(input: GitLabRequestInput): RequestInit {
    const init: RequestInit = {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${this.input.token}`,
        'Content-Type': 'application/json',
      },
      method: input.method ?? 'GET',
    };
    if (input.body !== undefined) init.body = JSON.stringify(input.body);
    return init;
  }
}

export function encodeGitLabProjectPath(owner: string, name: string): string {
  return encodeURIComponent(`${owner}/${name}`);
}

export function isGitLabAuthenticationFailure(error: Error | undefined): boolean {
  return error instanceof GitLabHttpError && error.status === 401;
}

export function isGitLabRepositoryAccessFailure(error: Error | undefined): boolean {
  return error instanceof GitLabHttpError && (error.status === 403 || error.status === 404);
}

async function readFailureMessage(response: Response): Promise<string> {
  const body: string = await response.text();
  return `GitLab API request failed with ${String(response.status)}${body.length > 0 ? `: ${body}` : ''}.`;
}
