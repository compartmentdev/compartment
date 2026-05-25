import { createServer, type AddressInfo, type Server } from 'node:net';

export async function findFreePort(host: string = '127.0.0.1'): Promise<number> {
  return await new Promise<number>((resolve: (port: number) => void, reject: (error: Error) => void): void => {
    const server: Server = createServer();

    server.once('error', reject);
    server.listen(0, host, (): void => {
      const address: string | AddressInfo | null = server.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('Failed to resolve a free TCP port.'));
        return;
      }

      const port: number = address.port;
      server.close((error?: Error): void => {
        if (error !== undefined) {
          reject(error);
          return;
        }

        resolve(port);
      });
    });
  });
}
