import { parse } from 'yaml';

type ParsedGitSourceYaml = ParsedGitSourceYamlObject | ParsedGitSourceYamlPrimitive | ParsedGitSourceYaml[];
type ParseYaml = (value: string) => ParsedGitSourceYaml;

interface ParsedGitSourceYamlObject {
  [key: string]: ParsedGitSourceYaml;
}

type ParsedGitSourceYamlPrimitive = boolean | null | number | string;
const parseYaml: ParseYaml = parse as ParseYaml;

export function parseGitSourceYaml(value: string): ParsedGitSourceYaml {
  const parsedYaml: ParsedGitSourceYaml = parseYaml(value);
  return parsedYaml;
}
