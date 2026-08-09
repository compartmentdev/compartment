import {
  KubernetesObjectApi,
  RequestContext,
  type HttpMethod,
  type KubernetesObject,
  type RequestBody,
} from '@kubernetes/client-node';

/**
 * Drives the real `KubernetesObjectApi.patch` serialization and captures the request body it would send, so tests can
 * assert the wire contract instead of the in-memory manifest.
 */
export class CapturingKubernetesObjectApi extends KubernetesObjectApi {
  public body: string | null = null;

  private readonly uriPath: string;

  public constructor(uriPath: string) {
    super({
      baseServer: {
        makeRequestContext: (path: string, method: HttpMethod): RequestContext =>
          new RequestContext(`https://kubernetes.test${path}`, method),
      },
    } as never);
    this.uriPath = uriPath;
  }

  protected override async specUriPath(): Promise<string> {
    return await Promise.resolve(this.uriPath);
  }

  protected override async requestPromise<T extends KubernetesObject>(requestContext: RequestContext): Promise<T> {
    const body: RequestBody = requestContext.getBody();
    if (typeof body !== 'string') {
      throw new Error('Expected the Kubernetes request body to be serialized JSON.');
    }
    this.body = body;
    return await Promise.resolve(JSON.parse(body) as T);
  }
}
