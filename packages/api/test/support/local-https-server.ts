import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from 'node:http';
import { createServer, type Server } from 'node:https';
import type { AddressInfo } from 'node:net';

export interface LocalHttpsRequest {
  headers: IncomingHttpHeaders;
  method: string;
  url: string;
}

export interface LocalHttpsServerHandle {
  close: () => Promise<void>;
  origin: string;
  requests: LocalHttpsRequest[];
}

type LocalHttpsRequestHandler = (request: IncomingMessage, response: ServerResponse) => Promise<void> | void;

const localHttpsPrivateKeyPem: string = `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQCdvqmx11Oi4WkT
Id7//9Z3JHO4y+ykicIXkB1jaJGM1P0z+w19I8DsfTKJ1F4D22lk0qw6maSiyHdf
CsPnf+IZe/10oFyhsOmviXG/xjOR3ylSY8tD+LIpZWdBeQvr7nFbQeODCPReovBt
kleCZ5DZ4FyBo/Y7aghhnQnIawuZcV/Emh/piMdFDfxzTLN+V+TDhHq52AuD029y
y8msTiHKRgr9R3KwaDW8+UCQT8VS5vK+1/8C2NSd3XZ+mjKfjVBpn7e3fPQpU+j2
yg5oR6IVjmi4/2H3lZr1L/h9J4thRMnGinVmvBvOLof1nCHTG/LT9bor7rFSac14
9yVG2O5fAgMBAAECggEAFoaH9+/OLyeuF//Rts/DQd8wMTbZk4NidnfrYmsnwasW
fyo9+l01KvAT2++5/yYBTlbxJisTgfVLaoSAhhnSYR4+Cr3tjF9Vd24SkraMXau2
3F+IwquMUXH8BTLyW14AzO3DPc51CuCMobDwkxwT6LDrtM2Dl2dkTAAfSgHTNbVr
67T05F/M8pviGVB2BI/5fHMJj8yobn/jWf87r88AkCDZIB/xeZSR5Jqvi30eUrHO
Q7qYV76kz9dRIGQM03WQvf0WX38tve87lsgf3XXcEEFpGi3lWoDdOiLqA3kKJ120
8feqdVSWrHuSG7QTh583Qu986Z0KXXaWv7X8YG0IiQKBgQDR4q/O9z2e96UU8VgM
IhDk68y0TR98sCilMfDvLHvxTj8waMWV67Or7dUiIRgRDngnL3IcuABSCCqF5Wns
HhDszTU4tAwVGjPS1IOxA57eTCa3xNTNU77UJez/eehMNeCthI8Llp7ZrP8sgCHN
V8dY0R3ylZzZ/4wQZolcNoRilwKBgQDAZz76BHqw+DDEPewxKOC7aqrSgZ0u4CHX
nor1cVFdjEcodcIyuvA2rFD2iF2qA64w6KWa4xNcx+Q77YhFGMZPWnDcI/3g/AhJ
gX26GKlTLXE6b8TjYjH1Io2bMFOKYlZGJZkyqm6Hg15PLsm4kU2oG74cfmYxlK7f
vGs9L/fzeQKBgQCgfUdT6ghrgw/vWLCr7myer5QDFqoKDSW3U93Y9Vn85Yk5+hOE
FQx5Xk5IX6foevjzdbs7LJPKJkZlxkvdagwlFrEon7xRcozIHQpqE8uqTe6ZPOA/
9VaJIEr9+3jetaAM7rz27oCfEEK7A2tVelaLmrPcp/ydUWQHsnA8W8+VFwKBgAyY
NZUkKevfs0GFVCq7pEpgZyI0fdeNsGlu5WW/rzXScu4BF18+wW6yxPH+ZzMz3nkx
IXYMGz5dj2Ek4WC0iHa1UuH2MS5DET/OjC5cYukg9mJ+4oKH8QE868wW08EhQsiA
uZCJe4a/YLMKOwYr7MtuVXmEBKiGNRRMPzDYLQDxAoGAHMYHwmcX8JLojHPm8F0R
3POvh+oOGD/f95v7eEGDg1yWFBQHULIxy0QTsj2fOc2ZTJnIuncmrXl2SJNHALG8
T/2l1q+/vQ0mnblQlSEHqcP+g6domfSA9VkHMzG3uBEnwAoAwmXH4LTcyKTvvP5J
BCa+1YsctSZW6RNJQexpj4A=
-----END PRIVATE KEY-----`;
const localHttpsCertificatePem: string = `-----BEGIN CERTIFICATE-----
MIIDJTCCAg2gAwIBAgIUTpb33qqkLt7HVQzK3UQ7VjR/+Q4wDQYJKoZIhvcNAQEL
BQAwFDESMBAGA1UEAwwJMTI3LjAuMC4xMB4XDTI2MDUwNTIxMjczN1oXDTI3MDUw
NTIyNDQ1MVowFDESMBAGA1UEAwwJMTI3LjAuMC4xMIIBIjANBgkqhkiG9w0BAQEF
AAOCAQ8AMIIBCgKCAQEAnb6psddTouFpEyHe///WdyRzuMvspInCF5AdY2iRjNT9
M/sNfSPA7H0yidReA9tpZNKsOpmkosh3XwrD53/iGXv9dKBcobDpr4lxv8Yzkd8p
UmPLQ/iyKWVnQXkL6+5xW0Hjgwj0XqLwbZJXgmeQ2eBcgaP2O2oIYZ0JyGsLmXFf
xJof6YjHRQ38c0yzflfkw4R6udgLg9NvcsvJrE4hykYK/UdysGg1vPlAkE/FUuby
vtf/AtjUnd12fpoyn41QaZ+3t3z0KVPo9soOaEeiFY5ouP9h95Wa9S/4fSeLYUTJ
xop1Zrwbzi6H9Zwh0xvy0/W6K+6xUmnNePclRtjuXwIDAQABo28wbTAdBgNVHQ4E
FgQUDYAvUelTZejg9RbXEw3liskpWiEwHwYDVR0jBBgwFoAUDYAvUelTZejg9RbX
Ew3liskpWiEwDwYDVR0TAQH/BAUwAwEB/zAaBgNVHREEEzARhwR/AAABgglsb2Nh
bGhvc3QwDQYJKoZIhvcNAQELBQADggEBAJ1OdQs4xdQHm/sKOGUDQk15A7ZOjvyj
stdknkttuZJPRRGPhcz/KaF5tdyNHdsnuVjZwL+ZJVv+nrDVL8aphn39tJuM6Fq9
DXw58r6zue9Q8Y1GQPD5raBkD2CkCHzTIFZ7hExGpAmdirVpcao2je88+7jA41R3
iRRKSFTFAFY6vW0ylxu203Ta19bVlFP7D4mNBLw9NlpZCOjZ8t8yiAyqimXAD98Q
KopitgbnUC5U8vjw1yGX4/Ob939fqzBFF4M6vW0ruFdIIvfdl5wX5of8qaH0gjld
kn5DdWmpW3Oz70cuHgHhvmOEGYN/Dd2aLLMS5wxFKYPFNA3eUhKDGkg=
-----END CERTIFICATE-----`;

export async function startLocalHttpsServer(handler: LocalHttpsRequestHandler): Promise<LocalHttpsServerHandle> {
  const requests: LocalHttpsRequest[] = [];
  const server: Server = createServer(
    {
      cert: localHttpsCertificatePem,
      key: localHttpsPrivateKeyPem,
    },
    (request: IncomingMessage, response: ServerResponse): void => {
      requests.push({
        headers: request.headers,
        method: request.method ?? 'GET',
        url: request.url ?? '/',
      });
      void Promise.resolve(handler(request, response)).catch((): void => {
        response.writeHead(500, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: 'test_https_server_failed' }));
      });
    },
  );

  await new Promise<void>((resolve: () => void): void => {
    server.listen(0, '127.0.0.1', resolve);
  });

  return new RunningLocalHttpsServer(server, readLocalHttpsServerOrigin(server), requests);
}

class RunningLocalHttpsServer implements LocalHttpsServerHandle {
  public constructor(
    private readonly server: Server,
    public readonly origin: string,
    public readonly requests: LocalHttpsRequest[],
  ) {}

  public async close(): Promise<void> {
    await new Promise<void>((resolve: () => void, reject: (reason?: Error) => void): void => {
      this.server.close((error?: Error): void => {
        if (error !== undefined) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }
}

function readLocalHttpsServerOrigin(server: Server): string {
  const address: AddressInfo | string | null = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('Expected local HTTPS server to listen on a TCP port.');
  }

  return `https://127.0.0.1:${address.port.toString()}`;
}
