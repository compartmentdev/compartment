export interface DockerNamespaceContainer {
  containerId: string;
  imageId: string;
  labels: Record<string, string>;
}

export interface DockerNamespaceImage {
  imageId: string;
}
