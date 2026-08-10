import { writeFileSync } from 'node:fs';
import {
  resourceReachabilityTargetsEnvironmentName,
  resourceReachabilityTargetsSchema,
  type ResourceReachabilityTarget,
} from './resource-reachability-probe.types';
import { awaitResourceReachability } from './services/resource-reachability.service';

/**
 * Init-container entry point for tenant Pods. It holds the Pod pre-Running until the resources that Pod dials
 * accept a connection, and fails naming the endpoint it could not reach.
 *
 * Kubernetes reads the failure back from the termination log, so the endpoint is visible in the Pod's own status
 * without reading container logs. The container also declares `FallbackToLogsOnError`, which covers a Pod whose
 * termination log cannot be written.
 */
const terminationLogPath: string = '/dev/termination-log';

async function main(): Promise<void> {
  const targets: ResourceReachabilityTarget[] = resourceReachabilityTargetsSchema.parse(
    JSON.parse(process.env[resourceReachabilityTargetsEnvironmentName] ?? '[]'),
  );
  await awaitResourceReachability(targets);
}

/**
 * The Pod spec overrides the image entrypoint, so this process is PID 1 with no init shim and Node applies no
 * default signal disposition. Without this a Pod deleted while the gate is still polling would ignore SIGTERM and
 * wait out its whole termination grace period.
 */
function exitOnTermination(): void {
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, (): void => {
      process.exit(1);
    });
  }
}

function reportFailure(error: Error): void {
  const message: string = error.message;
  process.exitCode = 1;
  console.error(message);
  try {
    writeFileSync(terminationLogPath, message, 'utf8');
  } catch {
    // The container's FallbackToLogsOnError policy already publishes the message written to stderr above.
  }
}

exitOnTermination();
void main().catch(reportFailure);
