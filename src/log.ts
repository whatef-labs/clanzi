// 플러그인 자체 로그. Studio 로그 위치가 문서와 달라 확인이 쉽도록 플러그인 폴더 아래에 남긴다.
import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';

const MAX_BYTES = 1024 * 1024;

export type Logger = (message: string, data?: unknown) => void;

export function createLogger(dir: string, name = 'plugin.log'): Logger {
  const file = join(dir, name);
  try { mkdirSync(dir, { recursive: true }); } catch { /* 로그 실패는 무시한다 */ }

  return (message, data) => {
    const line = `${new Date().toISOString()} ${message}${data === undefined ? '' : ' ' + safeJson(data)}\n`;
    try {
      const size = statSync(file, { throwIfNoEntry: false })?.size ?? 0;
      if (size > MAX_BYTES) {
        renameSync(file, file + '.1');
      }
      appendFileSync(file, line);
    } catch { /* 로그 실패가 플러그인을 멈추지 않게 한다 */ }
  };
}

function safeJson(data: unknown): string {
  try { return JSON.stringify(data); } catch { return String(data); }
}
