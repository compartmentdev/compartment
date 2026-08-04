export interface KubernetesSandboxRuntimePreflightInput {
  kubeContext?: string | undefined;
  kubeconfigPath: string;
  runtimeClassName: string;
}

export interface KubernetesSandboxRuntimeVerification {
  detail: string;
  runtimeClassName: string;
}
