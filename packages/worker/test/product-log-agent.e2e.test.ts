import { execFile } from 'node:child_process';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { immutableKubeName } from '@compartment/utils';
import { parseAllDocuments, type Document } from 'yaml';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

interface ConfigMapDocument {
  data: { 'vector.yaml': string };
  kind: string;
}

interface DaemonSetDocument {
  kind: string;
  spec: { template: { spec: { containers: { args: string[]; name: string }[] } } };
}

interface ReceivedLogEvent {
  containerName: string;
  message: string;
  namespace: string;
  podName: string;
  sourceFingerprint: string;
  sourceOffset: number;
  stream: 'stderr' | 'stdout';
  timestamp: string;
}

const execFileAsync: (file: string, args: string[]) => Promise<{ stderr: string; stdout: string }> =
  promisify(execFile);
const manifestPath: string = resolve(__dirname, '../manifests/product-log-agent.yaml');
const vectorImage: string =
  'timberio/vector:0.49.0-alpine@sha256:2a31648e67280953aaf6b219c1b04729ac5ed12820ec2bfb698630b2d989d135';
const resourceId: string = `res_${'a'.repeat(32)}`;
const resourceNamespace: string = immutableKubeName('cpt', `prj_${'b'.repeat(32)}`);
const resourcePodName: string = `${immutableKubeName('resource', resourceId)}-7bcf79d87f-q4m2n`;

describe('product log agent transport', (): void => {
  let accepting: boolean = true;
  let attempts: number = 0;
  let containerName: string;
  let configDirectory: string;
  let logFile: string;
  let logsDirectory: string;
  let rootDirectory: string;
  let resourceLogFile: string;
  let server: Server;
  let serverPort: number;
  let vectorDataVolume: string;
  let vectorArgs: string[];
  let vectorConfig: string;
  const received: ReceivedLogEvent[] = [];

  beforeAll(async (): Promise<void> => {
    rootDirectory = await mkdtemp(join(process.cwd(), '.tmp-vector-e2e-'));
    configDirectory = join(rootDirectory, 'config');
    logsDirectory = join(rootDirectory, 'pods');
    const podDirectory: string = join(
      logsDirectory,
      'cpt-project_app-deployment-abc_11111111-1111-4111-8111-111111111111',
      'app-deployment',
    );
    const resourcePodDirectory: string = join(
      logsDirectory,
      `${resourceNamespace}_${resourcePodName}_22222222-2222-4222-8222-222222222222`,
      'resource',
    );
    logFile = join(podDirectory, '0.log');
    resourceLogFile = join(resourcePodDirectory, '0.log');
    await mkdir(configDirectory);
    await mkdir(podDirectory, { recursive: true });
    await mkdir(resourcePodDirectory, { recursive: true });
    server = createServer((request: IncomingMessage, response: ServerResponse): void => {
      if (request.method !== 'POST') {
        response.writeHead(200).end();
        return;
      }
      attempts += 1;
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer): void => {
        chunks.push(chunk);
      });
      request.on('end', (): void => {
        if (!accepting) {
          response.writeHead(503).end();
          return;
        }
        const batch: ReceivedLogEvent[] = JSON.parse(Buffer.concat(chunks).toString('utf8')) as ReceivedLogEvent[];
        received.push(...batch);
        response.writeHead(200).end();
      });
    });
    await new Promise<void>((resolveListen: () => void): void => {
      server.listen(0, '0.0.0.0', resolveListen);
    });
    const address: AddressInfo | string | null = server.address();
    if (address === null || typeof address === 'string') {
      throw new Error('Expected the Vector test server to bind a TCP port.');
    }
    serverPort = address.port;
    const manifest: string = await readFile(manifestPath, 'utf8');
    const configMap: ConfigMapDocument | undefined = parseAllDocuments(manifest)
      .map((document: Document): ConfigMapDocument => document.toJSON() as ConfigMapDocument)
      .find((document: ConfigMapDocument): boolean => document.kind === 'ConfigMap');
    if (configMap === undefined) {
      throw new Error('Product log agent ConfigMap was not found.');
    }
    const daemonSet: DaemonSetDocument | undefined = parseAllDocuments(manifest)
      .map((document: Document): DaemonSetDocument => document.toJSON() as DaemonSetDocument)
      .find((document: DaemonSetDocument): boolean => document.kind === 'DaemonSet');
    const vectorContainer: { args: string[]; name: string } | undefined = daemonSet?.spec.template.spec.containers.find(
      (container: { args: string[]; name: string }): boolean => container.name === 'vector',
    );
    if (vectorContainer === undefined) {
      throw new Error('Product log agent Vector container was not found.');
    }
    vectorArgs = vectorContainer.args;
    vectorConfig = configMap.data['vector.yaml'];
    await writeFile(join(configDirectory, 'vector.yaml'), deploymentOnlyVectorConfig(vectorConfig));
    containerName = `compartment-vector-e2e-${process.pid.toString()}`;
    vectorDataVolume = `${containerName}-data`;
    await execFileAsync('docker', ['volume', 'create', vectorDataVolume]);
  }, 30_000);

  afterAll(async (): Promise<void> => {
    await stopVector();
    await execFileAsync('docker', ['volume', 'rm', '--force', vectorDataVolume]).catch((): undefined => undefined);
    await new Promise<void>((resolveClose: () => void): void => {
      server.close((): void => resolveClose());
    });
    await rm(rootDirectory, { force: true, recursive: true });
  });

  it('drains outages and preserves checkpoints and rotated offsets', async (): Promise<void> => {
    await writeFile(logFile, '');
    await startVector();
    await waitForVectorReady();
    const workloadStartedAt: number = Date.now();
    await writeFile(logFile, criLines('initial', 12_000));
    await waitFor((): boolean => receivedProductEvents(received).length === 12_000);
    expect(hasReceivedMessage(received, 'initial-11999')).toBe(true);
    expect(receivedProductEvents(received)).toHaveLength(12_000);
    const workloadDurationMs: number = Math.max(1, Date.now() - workloadStartedAt);
    expect(12_000 / (workloadDurationMs / 1_000)).toBeGreaterThanOrEqual(12_000);

    accepting = false;
    const attemptsBeforeOutage: number = attempts;
    await writeFile(logFile, criLines('during-outage', 100), { flag: 'a' });
    await waitFor((): boolean => attempts > attemptsBeforeOutage);
    expect(receivedProductEvents(received)).toHaveLength(12_000);
    accepting = true;
    await waitFor((): boolean => receivedProductEvents(received).length === 12_100);
    expect(hasReceivedMessage(received, 'during-outage-99')).toBe(true);
    expect(receivedProductEvents(received)).toHaveLength(12_100);
    expect(
      new Set(receivedProductEvents(received).map((event: ReceivedLogEvent): string => event.sourceFingerprint)).size,
    ).toBe(12_100);

    await stopVector();
    await writeFile(logFile, criLine('after-reopen'), { flag: 'a' });
    await startVector();
    await waitFor((): boolean => hasReceivedMessage(received, 'after-reopen'));
    expect(receivedProductEvents(received)).toHaveLength(12_101);
    expect(received.filter((event: ReceivedLogEvent): boolean => event.message === 'initial-0')).toHaveLength(1);

    await stopVector();
    await rename(logFile, `${logFile}.rotated`);
    await writeFile(logFile, criLine('rotated-0'));
    await startVector();
    await waitFor((): boolean => hasReceivedMessage(received, 'rotated-0'));
    expect(receivedProductEvents(received)).toHaveLength(12_102);
    const rotated: ReceivedLogEvent | undefined = receivedProductEvents(received).at(-1);
    const initial: ReceivedLogEvent | undefined = received.find(
      (event: ReceivedLogEvent): boolean => event.message === 'initial-0',
    );
    expect(rotated).toMatchObject({ sourceOffset: 0, timestamp: '2026-07-13T12:00:00.000000000Z' });
    expect(rotated?.sourceFingerprint).not.toBe(initial?.sourceFingerprint);

    await writeFile(resourceLogFile, criLine('database system is ready', 'stderr'));
    await writeFile(logFile, criLine('resource-config-control'), { flag: 'a' });
    await waitFor((): boolean => hasReceivedMessage(received, 'resource-config-control'));
    expect(hasReceivedMessage(received, 'database system is ready')).toBe(false);
    const vectorProcessIdentityBeforeReload: string = await readContainerIdentity();
    const productEventCountBeforeReload: number = receivedProductEvents(received).length;
    await replaceVectorConfig(vectorConfig);
    await waitFor((): boolean => hasReceivedMessage(received, 'database system is ready'));
    await writeFile(logFile, criLine('post-reload-control'), { flag: 'a' });
    await waitFor((): boolean => hasReceivedMessage(received, 'post-reload-control'));
    expect(await readContainerIdentity()).toBe(vectorProcessIdentityBeforeReload);
    expect(receivedProductEvents(received)).toHaveLength(productEventCountBeforeReload + 2);
    expect(received.filter((event: ReceivedLogEvent): boolean => event.message === 'initial-0')).toHaveLength(1);
    expect(
      received.find((event: ReceivedLogEvent): boolean => event.message === 'database system is ready'),
    ).toMatchObject({
      containerName: 'resource',
      message: 'database system is ready',
      namespace: resourceNamespace,
      podName: resourcePodName,
      stream: 'stderr',
    });
  }, 120_000);

  async function startVector(): Promise<void> {
    await execFileAsync('docker', [
      'run',
      '--detach',
      '--name',
      containerName,
      '--add-host',
      'host.docker.internal:host-gateway',
      '--env',
      `COMPARTMENT_LOG_INGEST_URL=http://host.docker.internal:${serverPort.toString()}/internal/kubernetes/logs`,
      '--env',
      'COMPARTMENT_PRODUCT_LOG_INGEST_TOKEN=e2e-token',
      '--volume',
      `${configDirectory}:/etc/vector:ro`,
      '--volume',
      `${logsDirectory}:/var/log/pods:ro`,
      '--volume',
      `${vectorDataVolume}:/var/lib/vector`,
      vectorImage,
      ...vectorArgs,
    ]);
  }

  async function stopVector(): Promise<void> {
    await execFileAsync('docker', ['rm', '--force', containerName]).catch((): undefined => undefined);
  }

  async function waitForVectorReady(): Promise<void> {
    const deadline: number = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const ready: boolean = await execFileAsync('docker', [
        'exec',
        containerName,
        'wget',
        '-qO-',
        'http://127.0.0.1:8686/health',
      ])
        .then((): boolean => true)
        .catch((): boolean => false);
      if (ready) {
        return;
      }
      await new Promise<void>((resolveWait: () => void): void => {
        setTimeout(resolveWait, 50);
      });
    }
    throw new Error('Timed out waiting for Vector readiness.');
  }

  async function readContainerIdentity(): Promise<string> {
    const inspected: { Id: string; State: { StartedAt: string } }[] = JSON.parse(
      (await execFileAsync('docker', ['inspect', containerName])).stdout,
    ) as { Id: string; State: { StartedAt: string } }[];
    const identity: { Id: string; State: { StartedAt: string } } | undefined = inspected[0];
    if (identity === undefined) {
      throw new Error('Product log agent container identity was not found.');
    }
    return `${identity.Id}/${identity.State.StartedAt}`;
  }

  async function replaceVectorConfig(config: string): Promise<void> {
    const nextConfigPath: string = join(configDirectory, 'vector.yaml.next');
    await writeFile(nextConfigPath, config);
    await rename(nextConfigPath, join(configDirectory, 'vector.yaml'));
  }
});

function criLines(marker: string, count: number): string {
  return [...Array<number>(count).keys()]
    .map((index: number): string => criLine(`${marker}-${index.toString()}`))
    .join('');
}

function criLine(message: string, stream: 'stderr' | 'stdout' = 'stdout'): string {
  return `2026-07-13T12:00:00.000000000Z ${stream} F ${message}\n`;
}

function deploymentOnlyVectorConfig(config: string): string {
  return config
    .replace('      - /var/log/pods/cpt-*/resource/*.log\n', '')
    .replace('app(?:-[a-z0-9-]+)?|resource', 'app(?:-[a-z0-9-]+)?');
}

function hasReceivedMessage(events: ReceivedLogEvent[], message: string): boolean {
  return events.some((event: ReceivedLogEvent): boolean => event.message === message);
}

function receivedProductEvents(events: ReceivedLogEvent[]): ReceivedLogEvent[] {
  return events.filter((event: ReceivedLogEvent): boolean => event.containerName !== 'vector-buffer-flush');
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline: number = Date.now() + 60_000;
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error('Timed out waiting for Vector log delivery.');
    }
    await new Promise<void>((resolveWait: () => void): void => {
      setTimeout(resolveWait, 50);
    });
  }
}
