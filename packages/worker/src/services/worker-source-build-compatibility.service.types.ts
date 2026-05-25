export interface WidenedNodeSourceBuildContextInput {
  buildContextDirectory: string;
  packer: 'dockerfile' | 'railpack' | 'static';
  serviceDirectory: string;
  serviceName: string;
  servicePath: string;
  serviceRelativePath: string;
}
