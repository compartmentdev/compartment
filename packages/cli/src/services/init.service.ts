import { basename, join } from 'node:path';
import {
  buildDefaultCompartmentAuthoredDescriptor,
  compartmentInitResultSchema,
  formatCompartmentAuthoredDescriptor,
  type CompartmentAuthoredDescriptor,
  type CompartmentInitResult,
} from '@compartment/contracts';
import { slugifyText } from '@compartment/utils';

import { writeCompartmentDescriptorFile } from '../store/project-descriptor.store';
import { readValidProjectName } from './project-name.service';
import type { InitializeProjectInput } from './init.types';

const compartmentDescriptorFileName: string = 'compartment.yml';
const compartmentDescriptorOutputPath: string = `./${compartmentDescriptorFileName}`;

export async function initializeProject({ cwd, name }: InitializeProjectInput): Promise<CompartmentInitResult> {
  const descriptor: CompartmentAuthoredDescriptor = buildDefaultCompartmentAuthoredDescriptor(name);
  const fileContents: string = formatCompartmentAuthoredDescriptor(descriptor);

  await writeCompartmentDescriptorFile(join(cwd, compartmentDescriptorFileName), fileContents);

  return compartmentInitResultSchema.parse({
    descriptor,
    file: compartmentDescriptorOutputPath,
  });
}

export function deriveSuggestedProjectName(cwd: string): string | undefined {
  const directoryName: string = basename(cwd);
  const normalizedName: string = slugifyText(directoryName);
  return readValidProjectName(normalizedName);
}
