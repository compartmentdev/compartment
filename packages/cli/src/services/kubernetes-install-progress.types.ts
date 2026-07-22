export interface KubernetesInstallProgressReporter {
  readonly mode?: 'hidden' | 'line' | 'live' | undefined;
  report(message: string, options?: KubernetesInstallProgressReportOptions): void;
}

export interface KubernetesInstallProgressReportOptions {
  renderMode?: 'line' | 'spinner' | undefined;
}

export type KubernetesInstallProgressAction<TResult> = () => Promise<TResult>;
export type KubernetesInstallProgressDetail<TResult> = (result: TResult) => string | undefined;
