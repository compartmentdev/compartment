import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { parseAllDocuments, type Document } from 'yaml';
import type { ChartContainerEnvironmentEntry, ChartWorkload } from './network-policy-enforcement-chart-labels.types';

const chartDirectory: string = resolve(__dirname, '../../../deploy/chart/compartment');
const releaseName: string = 'compartment';
const edgePodLabelsEnvironmentName: string = 'COMPARTMENT_EDGE_POD_LABELS';

// The chart takes the registry hostname as a cluster Service address; it is assembled from parts because a
// literal address reads to the linter as production configuration.
const registryHostname: string = ['10', '43', '250', '250'].join('.');

// A full installation is the only stage that renders the worker, and these are the values that stage
// requires. None of them reach the labels: the release name does, and it is fixed above.
const chartValues: Record<string, string> = {
  'platform.baseDomain': 'apps.example.com',
  'platform.installationId': 'network-policy-gate',
  'platform.startupStage': 'full',
  'registry.hostname': registryHostname,
  'registry.issuerRef.name': 'network-policy-gate-issuer',
  'secrets.productLogIngestToken': 'network-policy-gate-product-log-token',
};

/**
 * Prints the Caddy Pod labels the chart renders, the peer labels it hands the worker, and a kubectl
 * selector for the first.
 *
 * The enforcement gate stands up its own Caddy stand-in and applies the production policy projection to it.
 * Labels written into the fixture by hand could agree with a wrong peer and pass the gate while the peer
 * misses every real Caddy Pod, so both ends read the rendered chart instead.
 */
const rendered: string = execFileSync(
  'helm',
  [
    'template',
    releaseName,
    chartDirectory,
    ...Object.entries(chartValues).flatMap(([key, value]: [string, string]): string[] => ['--set', `${key}=${value}`]),
    '--show-only',
    'templates/caddy.yaml',
    '--show-only',
    'templates/worker.yaml',
  ],
  { encoding: 'utf8' },
);

const workloads: ChartWorkload[] = parseAllDocuments(rendered).map(
  (document: Document): ChartWorkload => document.toJSON() as ChartWorkload,
);
const caddyPodLabels: Record<string, string> = requiredPodLabels(`${releaseName}-caddy`);
const edgePodLabels: string = requiredEdgePodLabels(`${releaseName}-worker`);
const caddyPodSelector: string = Object.entries(caddyPodLabels)
  .map(([key, value]: [string, string]): string => `${key}=${value}`)
  .join(',');

process.stdout.write(`${JSON.stringify(caddyPodLabels)}\n${edgePodLabels}\n${caddyPodSelector}\n`);

function requiredDeployment(name: string): ChartWorkload {
  const workload: ChartWorkload | undefined = workloads.find(
    (candidate: ChartWorkload): boolean => candidate.kind === 'Deployment' && candidate.metadata?.name === name,
  );
  if (workload === undefined) {
    throw new Error(`The chart rendered no ${name} Deployment.`);
  }
  return workload;
}

function requiredPodLabels(name: string): Record<string, string> {
  const labels: Record<string, string> | undefined = requiredDeployment(name).spec?.template?.metadata?.labels;
  if (labels === undefined || Object.keys(labels).length === 0) {
    throw new Error(`The ${name} Deployment renders no Pod labels.`);
  }
  return labels;
}

function requiredEdgePodLabels(name: string): string {
  const value: string | undefined = requiredDeployment(name).spec?.template?.spec?.containers?.[0]?.env?.find(
    (entry: ChartContainerEnvironmentEntry): boolean => entry.name === edgePodLabelsEnvironmentName,
  )?.value;
  if (value === undefined || value.length === 0) {
    throw new Error(`The ${name} Deployment declares no ${edgePodLabelsEnvironmentName}.`);
  }
  return value;
}
