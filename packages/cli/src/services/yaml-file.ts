import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';

export type YamlFileValue = YamlFileObject | YamlFilePrimitive | YamlFileValue[];
export interface YamlFileObject {
  [key: string]: YamlFileValue;
}
type YamlFilePrimitive = boolean | null | number | string;

export async function readYamlFile(path: string, label: string): Promise<YamlFileValue> {
  let source: string;
  try {
    source = await readFile(path, 'utf8');
  } catch (error) {
    const detail: string = error instanceof Error ? error.message : 'unknown file-system error';
    throw new Error(`Failed to read ${label} "${path}": ${detail}`);
  }

  try {
    return (parse(source) ?? {}) as YamlFileValue;
  } catch (error) {
    const detail: string = error instanceof Error ? error.message : 'unknown YAML parsing error';
    throw new Error(`Failed to parse ${label} "${path}": ${detail}`);
  }
}
