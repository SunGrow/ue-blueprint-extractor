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

export function getTextContent(result: { content?: Array<{ text?: string; type: string }> }): string {
  return result.content?.find((entry) => entry.type === 'text')?.text ?? '';
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
