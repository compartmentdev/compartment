import type { CompartmentAuthoredDescriptor, CompartmentRoutesFile } from '@compartment/contracts';

export interface StoredProjectDescriptor {
  descriptor: CompartmentAuthoredDescriptor;
  filePath: string;
  repositoryRoot?: string | undefined;
  routes?: CompartmentRoutesFile | undefined;
}
