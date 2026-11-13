// 로컬 HTTP 브리지: clanzi mod가 보내는 세션 상태와 사용량을 받는다. 127.0.0.1에만 연다.
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { parseModMessage } from './protocol.ts';
import type { ModMessage } from './protocol.ts';
import type { Logger } from './log.ts';

export const DEFAULT_PORT = 39311;
const HOST = '127.0.0.1';
const MAX_BODY = 64 * 1024;
const RETRY_MS = 10_000;

export interface BridgeOptions {
  port: number;
  onMessage: (msg: ModMessage) => void;
  log: Logger;
}

export function startBridge({ port, onMessage, log }: BridgeOptions): Server {
  const server = createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'content-type': 'text/plain' }).end('clanzi');
      return;
    }
    if (req.method !== 'POST' || req.url !== '/event') {
      res.writeHead(404).end();
      return;
    }
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        res.writeHead(413).end();
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (res.headersSent) return;
      let msg: ModMessage | null = null;
      try {
        msg = parseModMessage(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        msg = null;
      }
      if (!msg) {
        res.writeHead(400).end();
        return;
      }
      res.writeHead(204).end();
      try {
        onMessage(msg);
      } catch (error) {
        log('bridge handler error', String(error));
      }
    });
  });

  server.on('error', (error: NodeJS.ErrnoException) => {
    // 포트를 다른 프로세스(이전 인스턴스 등)가 쥐고 있으면 잠시 뒤 다시 연다.
    log('bridge error', { code: error.code, message: error.message });
    if (error.code === 'EADDRINUSE') setTimeout(() => server.listen(port, HOST), RETRY_MS).unref();
  });
  server.on('listening', () => log('bridge listening', { host: HOST, port }));
  server.listen(port, HOST);
  return server;
}
