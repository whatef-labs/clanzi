// 세션 제목: Claude Code가 기록 파일에 남기는 ai-title 레코드에서 제목만 읽는다.
// 기록 파일의 끝부분만 읽고, 제목 줄 외의 내용은 쓰지도 남기지도 않는다.
import { open, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const TAIL_BYTES = 512 * 1024;
/** 같은 세션의 제목을 다시 읽는 최소 간격. */
const REFRESH_MS = 15_000;

/** Claude Code가 작업 폴더로 만드는 projects 아래 폴더 이름: 영숫자 외의 문자를 '-'로 바꾼다. */
export function projectDirName(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, '-');
}

/** 기록 파일 텍스트에서 마지막 ai-title을 찾는다. */
export function lastAiTitle(text: string): string | null {
  const lines = text.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i] ?? '';
    if (!line.includes('"ai-title"')) continue;
    try {
      const record: unknown = JSON.parse(line);
      if (typeof record === 'object' && record !== null && (record as { type?: unknown }).type === 'ai-title') {
        const title = (record as { aiTitle?: unknown }).aiTitle;
        if (typeof title === 'string' && title.trim()) return title.trim();
      }
    } catch {
      // 잘린 첫 줄 등은 건너뛴다
    }
  }
  return null;
}

export class TitleCache {
  private readonly titles = new Map<string, string>();
  private readonly lastRead = new Map<string, number>();
  private readonly paths = new Map<string, string>();
  private readonly projectsDir: string;

  constructor(projectsDir: string) {
    this.projectsDir = projectsDir;
  }

  get(sessionId: string): string | undefined {
    return this.titles.get(sessionId);
  }

  forget(sessionId: string): void {
    this.titles.delete(sessionId);
    this.lastRead.delete(sessionId);
    this.paths.delete(sessionId);
  }

  /** 제목을 다시 읽는다. 간격 안에 다시 부르면 무시한다. 실패는 조용히 넘긴다. */
  refresh(sessionId: string, cwd: string, now = Date.now()): void {
    if (now - (this.lastRead.get(sessionId) ?? 0) < REFRESH_MS) return;
    this.lastRead.set(sessionId, now);
    this.read(sessionId, cwd).then(
      (title) => { if (title) this.titles.set(sessionId, title); },
      () => {},
    );
  }

  private async read(sessionId: string, cwd: string): Promise<string | null> {
    const path = this.paths.get(sessionId) ?? (await this.locate(sessionId, cwd));
    if (!path) return null;
    this.paths.set(sessionId, path);
    const file = await open(path, 'r');
    try {
      const { size } = await file.stat();
      const length = Math.min(size, TAIL_BYTES);
      const buffer = Buffer.alloc(length);
      await file.read(buffer, 0, length, size - length);
      return lastAiTitle(buffer.toString('utf8'));
    } finally {
      await file.close();
    }
  }

  /** 작업 폴더로 경로를 만들어 보고, 없으면 projects 아래 폴더를 뒤진다. */
  private async locate(sessionId: string, cwd: string): Promise<string | null> {
    const fileName = `${sessionId}.jsonl`;
    const guess = join(this.projectsDir, projectDirName(cwd), fileName);
    if (await exists(guess)) return guess;
    for (const dir of await readdir(this.projectsDir).catch(() => [] as string[])) {
      const candidate = join(this.projectsDir, dir, fileName);
      if (await exists(candidate)) return candidate;
    }
    return null;
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    const f = await open(path, 'r');
    await f.close();
    return true;
  } catch {
    return false;
  }
}
