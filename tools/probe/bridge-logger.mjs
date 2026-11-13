// 임시 로거: 프로브 mod가 보내는 이벤트를 받아 ~/.claude/clanzi/probe/mod-events.log에 한 줄씩 남긴다.
// 실제 브리지(4단계)가 생기기 전까지 127.0.0.1:39311을 대신 연다.
import { createServer } from 'node:http';
import { appendFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const dir = join(homedir(), '.claude', 'clanzi', 'probe');
const file = join(dir, 'mod-events.log');
mkdirSync(dir, { recursive: true });

createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
    appendFileSync(file, `${new Date().toISOString()} ${req.method} ${req.url} ${body}\n`);
    res.writeHead(204).end();
  });
}).listen(39311, '127.0.0.1', () => console.log(`logging to ${file}`));
