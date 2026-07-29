import { createConnection, type Socket } from 'node:net';

const buildKitEndpointProbeTimeoutMs: number = 1_000;
type BuildKitEndpointResolve = () => void;
type BuildKitEndpointReject = (error: Error) => void;

export async function connectBuildKitEndpoint(hostname: string, port: number): Promise<void> {
  await new Promise<void>((resolve: BuildKitEndpointResolve, reject: BuildKitEndpointReject): void => {
    const socket: Socket = createConnection({ host: hostname, port });
    let settled: boolean = false;
    const finish: (error?: Error) => void = (error?: Error): void => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      if (error === undefined) {
        resolve();
      } else {
        reject(error);
      }
    };
    socket.setTimeout(buildKitEndpointProbeTimeoutMs, (): void => {
      const timeoutError: NodeJS.ErrnoException = new Error('BuildKit endpoint connection timed out.');
      timeoutError.code = 'ETIMEDOUT';
      finish(timeoutError);
    });
    socket.once('connect', (): void => finish());
    socket.once('error', (error: Error): void => finish(error));
  });
}
