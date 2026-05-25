import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface SelfHostedUserSetupAppFixture {
  readonly attackerServiceName?: string;
  readonly directory: string;
  readonly environmentName: string;
  readonly importedGroupFileName: string;
  readonly importedVariableFileName: string;
  readonly projectName: string;
  readonly resourceName: string;
  readonly serviceName: string;
  readonly variableGroupName: string;
}

interface SelfHostedUserSetupAppFixtureOptions {
  readonly includeCookieTossAttackerService?: boolean;
  readonly projectName?: string | undefined;
}

interface ProbeServiceDescriptorOptions {
  readonly includeResourceConnection: boolean;
}

const defaultProjectName: string = 'self-hosted-e2e-app';
const cookieTossAttackerServiceName: string = 'attacker';
const environmentName: string = 'production';
const resourceName: string = 'postgres';
const serviceName: string = 'web';
const variableGroupName: string = 'self-hosted-e2e-runtime';
const importedVariableFileName: string = '.env.self-hosted-e2e-import';
const importedGroupFileName: string = '.env.self-hosted-e2e-group-import';
const probeNodeImageRef: string = process.env.COMPARTMENT_TEST_APP_NODE_IMAGE ?? 'node:24.14.0-bookworm';
const probePostgresImageRef: string = process.env.COMPARTMENT_TEST_POSTGRES_IMAGE ?? 'postgres:16-alpine';

export const selfHostedUserSetupAppListeningLogText: string = 'self-hosted-e2e-app listening';

export async function createSelfHostedUserSetupAppFixture(
  tempRootDirectory: string,
  options: SelfHostedUserSetupAppFixtureOptions = {},
): Promise<SelfHostedUserSetupAppFixture> {
  const directory: string = await mkdtemp(join(tempRootDirectory, 'probe-app-'));
  const projectName: string = options.projectName ?? defaultProjectName;

  await writeFile(join(directory, 'Dockerfile'), probeDockerfile, 'utf8');
  await writeFile(join(directory, 'compartment.yml'), buildProbeDescriptor(options, projectName), 'utf8');
  await writeFile(join(directory, importedVariableFileName), 'IMPORTED_FLAG=true\n', 'utf8');
  await writeFile(join(directory, importedGroupFileName), 'IMPORTED_GROUP_FLAG=true\n', 'utf8');
  await writeFile(join(directory, 'server.mjs'), probeServer, 'utf8');

  return {
    ...(options.includeCookieTossAttackerService === true
      ? { attackerServiceName: cookieTossAttackerServiceName }
      : {}),
    directory,
    environmentName,
    importedGroupFileName,
    importedVariableFileName,
    projectName,
    resourceName,
    serviceName,
    variableGroupName,
  };
}

const probeDockerfile: string = `FROM ${probeNodeImageRef}
RUN apt-get update && apt-get install -y --no-install-recommends postgresql-client && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ARG E2E_BUILD_MESSAGE=missing-build-message
RUN printf '%s' "$E2E_BUILD_MESSAGE" > ./build-message.txt
COPY server.mjs ./server.mjs
EXPOSE 3000
CMD ["node", "server.mjs"]
`;

function buildProbeDescriptor(options: SelfHostedUserSetupAppFixtureOptions, projectName: string): string {
  const attackerServiceDescriptor: string =
    options.includeCookieTossAttackerService === true
      ? `${renderProbeServiceDescriptor(cookieTossAttackerServiceName, { includeResourceConnection: false })}\n`
      : '';

  return `name: ${projectName}

services:
${renderProbeServiceDescriptor(serviceName, { includeResourceConnection: true })}
${attackerServiceDescriptor}
resources:
  ${resourceName}:
    image: ${probePostgresImageRef}
    generatedVariables:
      POSTGRES_PASSWORD:
        generator: token
        bytes: 32
        encoding: hex
    env:
      POSTGRES_DB: app
      POSTGRES_USER: app
    ports:
      - 5432
    outputs:
      connection-url:
        sensitive: true
        value: postgres://\${env.POSTGRES_USER}:\${env.POSTGRES_PASSWORD}@\${resource.host}:5432/\${env.POSTGRES_DB}
    volumes:
      postgres-data: /var/lib/postgresql/data
    readiness:
      type: tcp
      port: 5432
      timeoutMs: 60000
    operations:
      backup:
        command: PGPASSWORD="$POSTGRES_PASSWORD" pg_dump --clean --if-exists --host "$COMPARTMENT_RESOURCE_HOST" --username "$POSTGRES_USER" "$POSTGRES_DB" > "$COMPARTMENT_BACKUP_DIR/dump.sql"
      restore:
        command: PGPASSWORD="$POSTGRES_PASSWORD" psql --host "$COMPARTMENT_RESOURCE_HOST" --username "$POSTGRES_USER" "$POSTGRES_DB" < "$COMPARTMENT_BACKUP_DIR/dump.sql"
`;
}

function renderProbeServiceDescriptor(name: string, options: ProbeServiceDescriptorOptions): string {
  const resourceConnections: string =
    options.includeResourceConnection === true
      ? `    connections:
      ${resourceName}:
        env:
          DATABASE_URL: connection-url
`
      : '';

  return `  ${name}:
    path: .
    build:
      strategy: dockerfile
      env:
        - E2E_BUILD_MESSAGE
    readiness:
      type: http
      path: /healthz
      timeoutMs: 60000
${resourceConnections}`;
}

const probeServer: string = `import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const port = Number.parseInt(process.env.PORT ?? '3000', 10);
const listeningLogText = '${selfHostedUserSetupAppListeningLogText}';
const buildMessageFileUrl = new URL('./build-message.txt', import.meta.url);

const server = createServer(async (request, response) => {
  try {
    const requestUrl = new URL(request.url ?? '/', \`http://\${request.headers.host ?? 'localhost'}\`);

    if (requestUrl.pathname === '/healthz') {
      sendJson(response, 200, { status: 'ok' });
      return;
    }
    if (requestUrl.pathname === '/probe/env') {
      sendJson(response, 200, {
        DIRECT_FLAG: process.env.DIRECT_FLAG ?? null,
        E2E_MESSAGE: process.env.E2E_MESSAGE ?? null,
      });
      return;
    }
    if (requestUrl.pathname === '/probe/build') {
      sendJson(response, 200, {
        E2E_BUILD_MESSAGE: await readBuildMessage(),
      });
      return;
    }
    if (requestUrl.pathname === '/probe/whoami') {
      sendJson(response, 200, {
        accessMode: readHeader(request.headers['x-compartment-access-mode']),
        organizationSlug: readHeader(request.headers['x-compartment-organization-slug']),
        principalEmail: readHeader(request.headers['x-compartment-principal-email']),
        principalId: readHeader(request.headers['x-compartment-principal-id']),
        principalType: readHeader(request.headers['x-compartment-principal-type']),
      });
      return;
    }
    if (requestUrl.pathname === '/probe/ingress') {
      sendJson(response, 200, {
        cookie: request.headers.cookie ?? null,
        compartmentHeaders: {
          accessMode: readHeader(request.headers['x-compartment-access-mode']),
          organizationId: readHeader(request.headers['x-compartment-organization-id']),
          organizationSlug: readHeader(request.headers['x-compartment-organization-slug']),
          principalEmail: readHeader(request.headers['x-compartment-principal-email']),
          principalId: readHeader(request.headers['x-compartment-principal-id']),
          principalType: readHeader(request.headers['x-compartment-principal-type']),
          role: readHeader(request.headers['x-compartment-role']),
          upstreamPort: readHeader(request.headers['x-compartment-upstream-port']),
        },
      });
      return;
    }
    if (requestUrl.pathname === '/probe/cookie-toss') {
      handleCookieToss(requestUrl, request, response);
      return;
    }
    if (requestUrl.pathname === '/probe/app-session-cookie-toss') {
      handleAppSessionCookieToss(requestUrl, request, response);
      return;
    }
    if (requestUrl.pathname === '/probe/host-app-session-cookie-toss') {
      handleHostAppSessionCookieToss(requestUrl, response);
      return;
    }
    if (requestUrl.pathname === '/probe/reserved-set-cookie-toss') {
      handleReservedSetCookieToss(response);
      return;
    }
    if (request.method === 'POST' && requestUrl.pathname === '/probe/db/write') {
      await handleDatabaseWrite(request, response);
      return;
    }
    if (request.method === 'GET' && requestUrl.pathname === '/probe/db/read') {
      await handleDatabaseRead(requestUrl, response);
      return;
    }

    sendJson(response, 404, { error: 'not_found' });
  } catch (error) {
    sendJson(response, 500, {
      error: 'probe_failed',
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

server.listen(port, () => {
  console.log(\`\${listeningLogText} on \${port}\`);
});

function handleCookieToss(requestUrl, request, response) {
  const token = requestUrl.searchParams.get('token') ?? '';
  if (token === '') {
    sendJson(response, 400, { error: 'missing_token' });
    return;
  }

  const domain = readParentCookieDomain(request.headers.host);
  response.setHeader(
    'Set-Cookie',
    \`compartment_session=\${token}; Domain=\${domain}; Path=/v1; Secure; SameSite=Lax\`,
  );
  sendJson(response, 200, { cookieTossed: true, domain });
}

function handleAppSessionCookieToss(requestUrl, request, response) {
  const token = requestUrl.searchParams.get('token') ?? '';
  if (token === '') {
    sendJson(response, 400, { error: 'missing_token' });
    return;
  }

  const domain = readParentCookieDomain(request.headers.host);
  response.setHeader(
    'Set-Cookie',
    \`compartment_app_session=\${token}; Domain=\${domain}; Path=/; Secure; SameSite=Lax\`,
  );
  sendJson(response, 200, { cookieTossed: true, domain });
}

function handleHostAppSessionCookieToss(requestUrl, response) {
  const token = requestUrl.searchParams.get('token') ?? '';
  if (token === '') {
    sendJson(response, 400, { error: 'missing_token' });
    return;
  }

  response.setHeader(
    'Set-Cookie',
    \`__Host-compartment_app_session=\${token}; Path=/; HttpOnly; Secure; SameSite=Lax\`,
  );
  sendJson(response, 200, { cookieTossed: true });
}

function handleReservedSetCookieToss(response) {
  response.setHeader('Set-Cookie', [
    '__Secure-compartment_session=bad; Path=/; HttpOnly; Secure; SameSite=Lax',
    'app_reserved_cookie_probe=allowed; Path=/; SameSite=Lax',
  ]);
  sendJson(response, 200, { reservedCookieTossed: true });
}

function readParentCookieDomain(hostHeader) {
  const hostname = new URL(\`http://\${hostHeader ?? ''}\`).hostname;
  const parts = hostname.split('.');
  if (parts.length < 3) {
    throw new Error(\`Cannot derive shared parent cookie domain from host \${hostname}\`);
  }

  return parts.slice(1).join('.');
}

async function handleDatabaseWrite(request, response) {
  const body = JSON.parse(await readRequestBody(request));
  const value = String(body.value ?? '');
  if (value === '') {
    sendJson(response, 400, { error: 'missing_value' });
    return;
  }

  await ensureProbeTable();
  await runPsql(\`insert into e2e_probe(value) values (\${quoteSqlLiteral(value)}) on conflict do nothing\`);
  sendJson(response, 200, { value, written: true });
}

async function handleDatabaseRead(requestUrl, response) {
  const value = requestUrl.searchParams.get('value') ?? '';
  if (value === '') {
    sendJson(response, 400, { error: 'missing_value' });
    return;
  }

  await ensureProbeTable();
  const output = await runPsql(\`select value from e2e_probe where value = \${quoteSqlLiteral(value)} limit 1\`);
  sendJson(response, 200, { found: output.trim() === value, value });
}

async function ensureProbeTable() {
  await runPsql('create table if not exists e2e_probe(value text primary key, created_at timestamptz not null default now())');
}

async function runPsql(sql) {
  const databaseUrl = requireEnv('DATABASE_URL');
  const { stdout } = await execFileAsync(
    'psql',
    [databaseUrl, '--no-align', '--tuples-only', '--quiet', '--set', 'ON_ERROR_STOP=1', '-c', sql],
    {
      env: {
        ...process.env,
        PGPASSWORD: process.env.POSTGRES_PASSWORD ?? '',
      },
      timeout: 15000,
    },
  );

  return stdout.trim();
}

async function readBuildMessage() {
  return (await readFile(buildMessageFileUrl, 'utf8')).trim();
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

function quoteSqlLiteral(value) {
  return \`'\${value.replaceAll("'", "''")}'\`;
}

function requireEnv(name) {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(\`Missing required env \${name}.\`);
  }

  return value;
}

function readHeader(value) {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, { 'content-type': 'application/json' });
  response.end(JSON.stringify(payload));
}
`;
