import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const chartDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const chart = parse(await readFile(resolve(chartDirectory, 'Chart.yaml'), 'utf8'));
const readme = await readFile(resolve(chartDirectory, 'README.md'), 'utf8');
const minimum = /^>=([0-9]+\.[0-9]+)/u.exec(chart.kubeVersion)?.[1];

assert.ok(minimum, 'Chart kubeVersion must declare a minimum major and minor version.');
const [minimumMajor, minimumMinor] = minimum.split('.').map(Number);
assert.ok(
  minimumMajor > 1 || (minimumMajor === 1 && minimumMinor >= 33),
  'Chart kubeVersion must require Kubernetes 1.33 or newer for image-volume support.',
);
assert.match(readme, new RegExp(`Kubernetes ${minimum.replace('.', '\\.')}(?:\\.0)? or newer`, 'u'));
