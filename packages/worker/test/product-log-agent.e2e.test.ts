import { execFile } from 'node:child_process';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { parseAllDocuments, type Document } from 'yaml';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

interface ConfigMapDocument {
  data: { 'vector.yaml': string };
  kind: string;
}

interface ReceivedLogEvent {
  containerName: string;
  message: string;
  namespace: string;
  podName: string;
  sourceFingerprint: string;
  sourceOffset: number;
  stream: string;
  timestamp: string;
}

const execFileAsync: (file: string, args: string[]) => Promise<{ stderr: string; stdout: string }> =
  promisify(execFile);
const manifestPath: string = resolve(__dirname, '../manifests/product-log-agent.yaml');
const vectorImage: string = 'timberio/vector:0.49.0-alpine';

describe('product log agent transport', (): void => {
  let accepting: boolean = true;
  let attempts: number = 0;
  let containerName: string;
  let configDirectory: string;
  let logFile: string;
  let logsDirectory: string;
  let resourceLogFile: string;
  let rootDirectory: string;
  let server: Server;
  let serverPort: number;
  let vectorDataVolume: string;
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
    logFile = join(podDirectory, '0.log');
    resourceLogFile = join(
      logsDirectory,
      'cpt-project_resource-res-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-ec88c3f4b4b78368-abc_22222222-2222-4222-8222-222222222222',
      'resource',
      '0.log',
    );
    await mkdir(configDirectory);
    await mkdir(podDirectory, { recursive: true });
    await mkdir(dirname(resourceLogFile), { recursive: true });
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
    await writeFile(join(configDirectory, 'vector.yaml'), configMap.data['vector.yaml']);
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
    await waitFor((): boolean => received.length === 12_000);
    const workloadDurationMs: number = Math.max(1, Date.now() - workloadStartedAt);
    expect(12_000 / (workloadDurationMs / 1_000)).toBeGreaterThanOrEqual(12_000);

    accepting = false;
    const attemptsBeforeOutage: number = attempts;
    await writeFile(logFile, criLines('during-outage', 100), { flag: 'a' });
    await waitFor((): boolean => attempts > attemptsBeforeOutage);
    expect(received).toHaveLength(12_000);
    accepting = true;
    await waitFor((): boolean => received.length === 12_100);
    expect(new Set(received.map((event: ReceivedLogEvent): string => event.sourceFingerprint)).size).toBe(12_100);

    await stopVector();
    await writeFile(logFile, criLine('after-reopen'), { flag: 'a' });
    await startVector();
    await waitFor((): boolean => received.length === 12_101);
    expect(received.filter((event: ReceivedLogEvent): boolean => event.message === 'initial-0')).toHaveLength(1);

    await stopVector();
    await rename(logFile, `${logFile}.rotated`);
    await writeFile(logFile, criLine('initial-0'));
    await startVector();
    await waitFor((): boolean => received.length === 12_102);
    const rotated: ReceivedLogEvent | undefined = received.at(-1);
    const initial: ReceivedLogEvent | undefined = received.find(
      (event: ReceivedLogEvent): boolean => event.message === 'initial-0',
    );
    expect(rotated).toMatchObject({ sourceOffset: 0, timestamp: '2026-07-13T12:00:00.000000000Z' });
    expect(rotated?.sourceFingerprint).not.toBe(initial?.sourceFingerprint);

    await writeFile(resourceLogFile, criLine('database-system-ready'));
    await waitFor((): boolean =>
      received.some((event: ReceivedLogEvent): boolean => event.message === 'database-system-ready'),
    );
    expect(
      received.find((event: ReceivedLogEvent): boolean => event.message === 'database-system-ready'),
    ).toMatchObject({
      containerName: 'resource',
      namespace: 'cpt-project',
      podName: 'resource-res-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-ec88c3f4b4b78368-abc',
      stream: 'stdout',
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
      '--config',
      '/etc/vector/vector.yaml',
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
});

function criLines(marker: string, count: number): string {
  return [...Array<number>(count).keys()]
    .map((index: number): string => criLine(`${marker}-${index.toString()}`))
    .join('');
}

function criLine(message: string): string {
  return `2026-07-13T12:00:00.000000000Z stdout F ${message}\n`;
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
