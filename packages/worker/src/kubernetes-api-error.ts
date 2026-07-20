interface KubernetesStatusBody {
  message?: string | undefined;
}

export type KubernetesApiErrorBody = KubernetesStatusBody | boolean | number | string | null | undefined;

export function readKubernetesStatusMessage(body: KubernetesApiErrorBody): string | undefined {
  if (typeof body === 'string') {
    try {
      const parsedBody: KubernetesApiErrorBody = JSON.parse(body) as KubernetesApiErrorBody;
      return readKubernetesStatusMessage(parsedBody);
    } catch {
      return body;
    }
  }
  if (typeof body === 'object' && body !== null) {
    return body.message;
  }
  return undefined;
}
