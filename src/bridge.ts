// 로컬 HTTP 브리지: clanzi mod가 보내는 세션 상태와 사용량을 받는다. 127.0.0.1에만 연다.
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { parseModMessage } from './protocol.ts';
import type { ModMessage } from './protocol.ts';
import type { Logger } from './log.ts';

export const DEFAULT_PORT = 39311;
const HOST = '127.0.0.1';
const MAX_BODY = 64 * 1024;
/** 포트를 이전 인스턴스가 쥐고 있을 때 다시 여는 간격 */
const RETRY_MS = 1_000;

export interface BridgeOptions {
  port: number;
  onMessage: (msg: ModMessage) => void;
  /** GET /debug 응답. 세션 목록과 배정 상태를 확인할 때 쓴다. */
  debug?: () => unknown;
  /** POST /shutdown: 새로 뜬 인스턴스가 포트를 넘겨 달라고 할 때 */
  onShutdown?: () => void;
  log: Logger;
}

export function startBridge({ port, onMessage, debug, onShutdown, log }: BridgeOptions): Server {
  const server = createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'content-type': 'text/plain' }).end('clanzi');
      return;
    }
    if (req.method === 'GET' && req.url === '/debug' && debug) {
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(debug(), null, 2));
      return;
    }
    if (req.method === 'POST' && req.url === '/shutdown' && onShutdown) {
      res.writeHead(204).end(() => onShutdown());
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
    log('bridge error', { code: error.code, message: error.message });
    if (error.code !== 'EADDRINUSE') return;
    // 이전 인스턴스(Studio 재시작이 엇갈린 경우 등)가 포트를 쥐고 있으면 넘겨 달라고 하고 잠시 뒤 다시 연다.
    fetch(`http://${HOST}:${port}/shutdown`, { method: 'POST' }).catch(() => {});
    setTimeout(() => server.listen(port, HOST), RETRY_MS).unref();
  });
  server.on('listening', () => log('bridge listening', { host: HOST, port }));
  server.listen(port, HOST);
  return server;
}
