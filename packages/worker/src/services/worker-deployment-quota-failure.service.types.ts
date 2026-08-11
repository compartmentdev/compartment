export interface KubernetesApiErrorShape extends Error {
  body?: KubernetesStatusShape | string | undefined;
  code?: number | undefined;
  statusCode?: number | undefined;
}

export interface KubernetesStatusShape {
  message?: string | undefined;
  reason?: string | undefined;
}
