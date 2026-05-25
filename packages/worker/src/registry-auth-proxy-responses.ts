import type { ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';

const registryUnauthorizedResponseBody: string =
  '{"error":"registry_unauthorized","message":"Registry credentials are required."}\n';
const registryBadRequestResponseBody: string =
  '{"error":"registry_bad_request","message":"Invalid registry proxy request."}\n';

export function sendUnauthorized(response: ServerResponse): void {
  response.writeHead(401, {
    'Content-Length': Buffer.byteLength(registryUnauthorizedResponseBody).toString(),
    'Content-Type': 'application/json',
    'WWW-Authenticate': 'Basic realm="Compartment artifact registry"',
  });
  response.end(registryUnauthorizedResponseBody);
}

export function sendBadRequest(response: ServerResponse): void {
  response.writeHead(400, {
    'Content-Length': Buffer.byteLength(registryBadRequestResponseBody).toString(),
    'Content-Type': 'application/json',
  });
  response.end(registryBadRequestResponseBody);
}

export function writeRawUnauthorized(socket: Duplex): void {
  writeRawJsonResponse(socket, 401, 'Unauthorized', registryUnauthorizedResponseBody, {
    'WWW-Authenticate': 'Basic realm="Compartment artifact registry"',
  });
}

export function writeRawBadRequest(socket: Duplex): void {
  writeRawJsonResponse(socket, 400, 'Bad Request', registryBadRequestResponseBody);
}

function writeRawJsonResponse(
  socket: Duplex,
  statusCode: number,
  statusMessage: string,
  body: string,
  headers: Record<string, string> = {},
): void {
  const responseHeaders: string[] = [
    `HTTP/1.1 ${statusCode.toString()} ${statusMessage}`,
    'Content-Type: application/json',
    'Connection: close',
    `Content-Length: ${Buffer.byteLength(body).toString()}`,
  ];
  for (const [name, value] of Object.entries(headers)) {
    responseHeaders.push(`${name}: ${value}`);
  }

  socket.end(`${responseHeaders.join('\r\n')}\r\n\r\n${body}`);
}
