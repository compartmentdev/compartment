import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parse, parseAllDocuments, type Document } from 'yaml';

interface ChartImageValues {
  images: { productLogAgent: { digest: string; repository: string; tag: string } };
}

const chartDirectory: string = resolve(__dirname, '../../../deploy/chart/compartment');
const vectorConfigPath: string = resolve(chartDirectory, 'files/product-log-agent-vector.yaml');
const templatePath: string = resolve(chartDirectory, 'templates/product-log-agent.yaml');
const valuesPath: string = resolve(chartDirectory, 'values.yaml');

export async function readProductLogAgentImage(): Promise<string> {
  const values: ChartImageValues = parse(await readFile(valuesPath, 'utf8')) as ChartImageValues;
  const { digest, repository, tag } = values.images.productLogAgent;

  return `${repository}:${tag}@${digest}`;
}

export async function readProductLogAgentVectorConfig(): Promise<string> {
  return await readFile(vectorConfigPath, 'utf8');
}

export async function readProductLogAgentTemplate(): Promise<string> {
  return await readFile(templatePath, 'utf8');
}

/**
 * Parses the shipped chart template by replacing Helm actions with placeholders so structural
 * assertions can read the manifest the platform actually installs. Templating the parsed fields
 * fails the parse loudly instead of silently drifting.
 */
export async function readProductLogAgentDocuments(): Promise<object[]> {
  const template: string = await readProductLogAgentTemplate();
  const withoutDirectiveLines: string = template
    .split('\n')
    .filter((line: string): boolean => !/^\s*\{\{-?[^}]*\}\}\s*$/u.test(line))
    .join('\n');
  const rendered: string = withoutDirectiveLines.replaceAll(/\{\{-?.*?-?\}\}/gu, 'chart-value');

  return parseAllDocuments(rendered).map((document: Document): object => document.toJSON() as object);
}
