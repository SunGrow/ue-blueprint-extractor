import { readFile } from 'node:fs/promises';
import { once } from 'node:events';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { RemoteCallRequest } from '../src/types.js';

export interface MockHttpResponse {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
}

export interface MockRemoteControlOptions {
  remoteInfoStatus?: number;
  remoteInfoBody?: unknown;
  onCall?: (request: RemoteCallRequest) => MockHttpResponse | Promise<MockHttpResponse>;
}

export interface MockRemoteControlServer {
  close: () => Promise<void>;
  host: string;
  port: number;
  requests: RemoteCallRequest[];
}

export interface FixtureFileRoute {
  filePath: string;
  contentType?: string;
  requiredHeaders?: Record<string, string>;
}

export interface FixtureFileRequest {
  url: string;
  headers: Record<string, string>;
}

export interface FixtureFileServer {
  close: () => Promise<void>;
  host: string;
  port: number;
  requests: FixtureFileRequest[];
}

export async function connectInMemoryServer(server: McpServer) {
  const client = new Client({
    name: 'blueprint-extractor-tests',
    version: '1.0.0',
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await server.connect(serverTransport);
  await client.connect(clientTransport);

  return {
    client,
    async close() {
      await Promise.allSettled([client.close(), server.close()]);
    },
  };
}

export function getTextContent(result: {
  content?: Array<{ text?: string; type: string }>;
  structuredContent?: unknown;
}): string {
  const text = result.content?.find((entry) => entry.type === 'text')?.text;
  if (typeof text === 'string' && text.length > 0) {
    return text;
  }

  return result.structuredContent !== undefined
    ? JSON.stringify(result.structuredContent)
    : '';
}

export function parseToolResult<T = Record<string, unknown>>(result: {
  content?: Array<{ text?: string; type: string }>;
  structuredContent?: unknown;
}): T {
  if (result.structuredContent !== undefined && result.structuredContent !== null) {
    return result.structuredContent as T;
  }

  return JSON.parse(getTextContent(result)) as T;
}

export async function startMockRemoteControlServer(
  options: MockRemoteControlOptions = {},
): Promise<MockRemoteControlServer> {
  const requests: RemoteCallRequest[] = [];
  const sockets = new Set<Socket>();
  const host = '127.0.0.1';

  const server = createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/remote/info') {
      writeJson(res, options.remoteInfoStatus ?? 200, options.remoteInfoBody ?? { ok: true });
      return;
    }

    if (req.method === 'PUT' && req.url === '/remote/object/call') {
      const request = await readJsonBody<RemoteCallRequest>(req);
      requests.push(request);

      const response = options.onCall
        ? await options.onCall(request)
        : { status: 404, body: { error: 'Unhandled call' } };

      if ((response.status ?? 200) === 204) {
        res.writeHead(204);
        res.end();
        return;
      }

      writeJson(res, response.status ?? 200, response.body ?? {});
      return;
    }

    writeJson(res, 404, { error: 'Not found' });
  });

  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => {
      sockets.delete(socket);
    });
  });

  server.listen(0, host);
  await once(server, 'listening');

  const address = server.address() as AddressInfo;

  return {
    host,
    port: address.port,
    requests,
    async close() {
      for (const socket of sockets) {
        socket.destroy();
      }

      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    },
  };
}

export async function startFixtureFileServer(
  routes: Record<string, FixtureFileRoute>,
): Promise<FixtureFileServer> {
  const sockets = new Set<Socket>();
  const requests: FixtureFileRequest[] = [];
  const host = '127.0.0.1';

  const server = createServer(async (req, res) => {
    const url = req.url ?? '/';
    const route = routes[url];
    const headers = normalizeHeaders(req.headers);
    requests.push({ url, headers });

    if (!route) {
      writeJson(res, 404, { error: 'Not found' });
      return;
    }

    for (const [key, expectedValue] of Object.entries(route.requiredHeaders ?? {})) {
      if (headers[key.toLowerCase()] !== expectedValue) {
        writeJson(res, 401, { error: 'Unauthorized' });
        return;
      }
    }

    try {
      const file = await readFile(route.filePath);
      res.writeHead(200, {
        'Content-Type': route.contentType ?? 'application/octet-stream',
      });
      res.end(file);
    } catch {
      writeJson(res, 500, { error: 'Failed to read fixture file' });
    }
  });

  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => {
      sockets.delete(socket);
    });
  });

  server.listen(0, host);
  await once(server, 'listening');

  const address = server.address() as AddressInfo;

  return {
    host,
    port: address.port,
    requests,
    async close() {
      for (const socket of sockets) {
        socket.destroy();
      }

      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    },
  };
}

async function readJsonBody<T>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];

  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const raw = Buffer.concat(chunks).toString('utf8');
  return JSON.parse(raw) as T;
}

function writeJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    ...headers,
  });
  res.end(JSON.stringify(body));
}

function normalizeHeaders(headers: IncomingMessage['headers']): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === 'string') {
      normalized[key.toLowerCase()] = value;
    } else if (Array.isArray(value)) {
      normalized[key.toLowerCase()] = value.join(', ');
    }
  }
  return normalized;
}
