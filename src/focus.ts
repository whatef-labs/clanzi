// 세션 창으로 이동: 창 전환 도우미(plugin/focus-helper.exe, 소스는 native/focus-helper.cs)를 한 번 띄워 두고 요청마다 재사용한다.
import { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { folderName } from './slots.ts';
import type { Logger } from './log.ts';

export type FocusRequest =
  | { op: 'vscode'; folder: string; session: string }
  | { op: 'pid'; pid: number; folder: string }
  /** 그 PID가 claude 프로세스일 때만 하위 프로세스까지 강제 종료한다. */
  | { op: 'kill'; pid: number }
  /** 기본 브라우저로 연다(https만). */
  | { op: 'url'; url: string };

/** 응답 제한 시간. 강제 종료(taskkill)가 하위 프로세스를 정리하는 시간까지 넉넉히 둔다. */
const TIMEOUT_MS = 8000;

/** 세션이 어디서 실행 중인지에 따라 요청을 정한다. 이동할 방법이 없으면 null. */
export function focusRequestFor(s: { id: string; cwd: string; origin?: string; pid?: number }): FocusRequest | null {
  const folder = folderName(s.cwd);
  if (s.origin === 'claude-vscode') return { op: 'vscode', folder, session: s.id };
  if (s.pid) return { op: 'pid', pid: s.pid, folder };
  return null;
}

export class FocusHelper {
  private readonly exe: string;
  private readonly log: Logger;
  private child: ChildProcessWithoutNullStreams | null = null;
  private pending: Array<(line: string) => void> = [];

  constructor(exe: string, log: Logger) {
    this.exe = exe;
    this.log = log;
    process.on('exit', () => this.child?.kill());
  }

  /** 결과 한 줄(focused:switch, focused:attach, opened, killed, not-claude:…, not-found, blocked, error:…, timeout)을 돌려준다. */
  request(req: FocusRequest): Promise<string> {
    const child = this.ensure();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        // 응답 순서가 어긋나지 않게 도우미를 새로 띄운다
        this.reset('timeout');
        resolve('timeout');
      }, TIMEOUT_MS);
      this.pending.push((line) => {
        clearTimeout(timer);
        resolve(line);
      });
      child.stdin.write(JSON.stringify(req) + '\n');
    });
  }

  private ensure(): ChildProcessWithoutNullStreams {
    if (this.child) return this.child;
    const child = spawn(this.exe, [], { windowsHide: true });
    let ready = false;
    createInterface({ input: child.stdout }).on('line', (line) => {
      if (!ready && line === 'ready') {
        ready = true;
        return;
      }
      this.pending.shift()?.(line.trim());
    });
    child.stderr.on('data', (chunk: Buffer) => this.log('focus helper stderr', chunk.toString('utf8').slice(0, 300)));
    child.on('exit', (code) => {
      if (this.child === child) this.reset(`exited:${code}`);
    });
    this.child = child;
    return child;
  }

  private reset(reason: string): void {
    const child = this.child;
    this.child = null;
    child?.kill();
    for (const resolve of this.pending.splice(0)) resolve(reason);
  }
}
