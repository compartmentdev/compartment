export interface RuntimeDockerTailLogsInput {
  containerId: string;
  since?: string | undefined;
  tailLines?: number | undefined;
}
