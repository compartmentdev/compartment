import { findStoredProjectDescriptor } from './project-descriptor.service';
import type { StoredProjectDescriptor } from './project-descriptor.types';
import type { ResolvedProjectTarget } from './projects.service.types';

export async function resolveProjectTarget(cwd: string, explicitProjectName?: string): Promise<ResolvedProjectTarget> {
  const descriptor: StoredProjectDescriptor | undefined = await findStoredProjectDescriptor(cwd);
  if (explicitProjectName !== undefined) {
    return {
      ...(descriptor !== undefined ? { descriptor } : {}),
      projectName: explicitProjectName,
      updatesLocalDescriptor: descriptor?.descriptor.name === explicitProjectName,
    };
  }
  if (descriptor === undefined) {
    throw new Error(
      'compartment.yml was not found in the current directory. Pass --project <slug> or run inside a compartment repo.',
    );
  }

  return {
    descriptor,
    projectName: descriptor.descriptor.name,
    updatesLocalDescriptor: true,
  };
}
