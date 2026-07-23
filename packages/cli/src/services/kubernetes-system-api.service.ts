import { errorResponseSchema, type ErrorResponse } from '@compartment/contracts';
import { parseJsonWith, type JsonValue } from '@compartment/utils';
import { z } from 'zod';
import { runCommand, runCommandWithInput } from '../command-runner';
import type { CommandResult } from '../command-runner.types';
import { buildKubectlCommand, readCommandOutput } from './kubernetes-command.support';
import type {
  KubernetesOperatorTarget,
  KubernetesResourceList,
  KubernetesResourceListItem,
  KubernetesSystemApiRequest,
  KubernetesSystemApiResponseEnvelope,
} from './kubernetes-operator.service.types';

const systemApiNodeProgram: string = `const http=require('node:http');let input='';process.stdin.setEncoding('utf8');process.stdin.on('data',c=>input+=c);process.stdin.on('end',()=>{const r=JSON.parse(input);const body=r.body===undefined?undefined:JSON.stringify(r.body);const headers={Accept:'application/json',Authorization:'Bearer '+process.env.COMPARTMENT_SYSTEM_TOKEN,...(body===undefined?{}:{'Content-Length':Buffer.byteLength(body),'Content-Type':'application/json'}),...(r.idempotencyKey===undefined?{}:{'Idempotency-Key':r.idempotencyKey})};const q=http.request({headers,method:r.method,path:r.path,socketPath:process.env.COMPARTMENT_SYSTEM_API_SOCKET},res=>{const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>process.stdout.write(JSON.stringify({body:Buffer.concat(chunks).toString('utf8'),statusCode:res.statusCode})));});q.on('error',e=>{process.stderr.write(e.message);process.exitCode=1;});if(body!==undefined)q.write(body);q.end();});`;
const kubernetesResourceListSchema: z.ZodType<{ items: JsonValue[] }> = z
  .object({
    items: z.array(z.custom<JsonValue>()),
  })
  .passthrough();
const kubernetesSystemApiResponseEnvelopeSchema: z.ZodType<KubernetesSystemApiResponseEnvelope> = z
  .object({
    body: z.string(),
    statusCode: z.number(),
  })
  .passthrough();

export async function requestKubernetesSystemApi<TResponse>(
  target: KubernetesOperatorTarget,
  request: KubernetesSystemApiRequest,
  parse: (value: JsonValue | null) => TResponse,
): Promise<TResponse> {
  const deploymentName: string = await readApiDeploymentName(target);
  const result: CommandResult = await runCommandWithInput(
    buildSystemApiExecCommand(target, deploymentName),
    JSON.stringify(request),
  );
  if (result.exitCode !== 0) {
    throw new Error(`Private system API request failed: ${readCommandOutput(result)}`);
  }
  const envelope: KubernetesSystemApiResponseEnvelope = parseResponseEnvelope(result.stdout);
  const value: JsonValue | null = envelope.body === '' ? null : (JSON.parse(envelope.body) as JsonValue);
  if (envelope.statusCode >= 400) {
    throw new Error(readSystemApiError(value));
  }
  return parse(value);
}

function buildSystemApiExecCommand(target: KubernetesOperatorTarget, deploymentName: string): string[] {
  return buildKubectlCommand(target, [
    'exec',
    '--stdin',
    '--container',
    'api',
    `deployment/${deploymentName}`,
    '--',
    'node',
    '-e',
    systemApiNodeProgram,
  ]);
}

async function readApiDeploymentName(target: KubernetesOperatorTarget): Promise<string> {
  const result: CommandResult = await runCommand(
    buildKubectlCommand(target, [
      'get',
      'deployments',
      '--selector',
      `app.kubernetes.io/instance=${target.releaseName},app.kubernetes.io/component=api`,
      '--output',
      'json',
    ]),
  );
  if (result.exitCode !== 0) {
    throw new Error(`Failed to find the API deployment: ${readCommandOutput(result)}`);
  }
  const list: KubernetesResourceList = parseResourceList(result.stdout);
  const name: string | undefined = list.items[0]?.metadata?.name;
  if (list.items.length !== 1 || name === undefined || name === '') {
    throw new Error('Expected exactly one API deployment for the Helm release.');
  }
  return name;
}

function parseResponseEnvelope(output: string): KubernetesSystemApiResponseEnvelope {
  return parseJsonWith(kubernetesSystemApiResponseEnvelopeSchema, output);
}

function parseResourceList(output: string): KubernetesResourceList {
  const value: { items: JsonValue[] } = parseJsonWith(kubernetesResourceListSchema, output);
  return { items: value.items.filter(isResourceListItem) };
}

function isResourceListItem(value: JsonValue): value is KubernetesResourceListItem & JsonValue {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readSystemApiError(value: JsonValue | null): string {
  try {
    const result: ErrorResponse = errorResponseSchema.parse(value);
    return result.error.message;
  } catch {
    return 'Private system API request failed.';
  }
}
