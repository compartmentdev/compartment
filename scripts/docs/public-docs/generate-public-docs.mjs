import { generateCliReferencePages } from './cli-reference-generator.mjs';
import { recreateGeneratedRootDirectory } from './public-docs-files.mjs';
import { generateSchemaReferencePages } from './schema-reference-generator.mjs';
import { runMain } from '../../lib/run-main.mjs';

export async function main() {
  await generatePublicDocs();
}

export async function generatePublicDocs() {
  await recreateGeneratedRootDirectory();
  await generateCliReferencePages();
  await generateSchemaReferencePages();
}

runMain(import.meta.url, process.argv[1], main);
