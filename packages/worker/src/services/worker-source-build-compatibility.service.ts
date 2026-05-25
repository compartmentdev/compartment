import { hasDirectoryFile } from './worker-source-file-presence.service';
import type { WidenedNodeSourceBuildContextInput } from './worker-source-build-compatibility.service.types';

export async function validateWidenedNodeSourceBuildContext(input: WidenedNodeSourceBuildContextInput): Promise<void> {
  if (input.packer === 'dockerfile' || input.serviceRelativePath === '.') {
    return;
  }

  if (!(await hasNodePackageManifest(input.serviceDirectory))) {
    return;
  }

  if (await hasNodePackageManifest(input.buildContextDirectory)) {
    return;
  }

  throw new Error(createWidenedNodeSourceBuildContextError(input.serviceName, input.servicePath));
}

async function hasNodePackageManifest(directory: string): Promise<boolean> {
  return await hasDirectoryFile(directory, 'package.json');
}

function createWidenedNodeSourceBuildContextError(serviceName: string, servicePath: string): string {
  return [
    `Source builds for service "${serviceName}" (path "${servicePath}") install from the widened context root, not the service directory.`,
    'The widened build context is missing "package.json" while the service directory contains one.',
    'Add the root workspace/package-manager files the widened build expects, or avoid widening build.include/refactor the project layout.',
  ].join(' ');
}
