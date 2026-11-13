// 키를 눌러 확인한 완료·오류 표시를 파일에 남겨, 플러그인이 다시 시작돼도(Studio 재시작 등)
// 이미 확인한 세션이 다시 초록·빨강으로 보이지 않게 한다.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** 이보다 오래된 기록은 읽을 때 버린다. 플러그인이 꺼져 있는 동안 끝난 세션의 기록이 쌓이지 않게 한다. */
export const ACK_KEEP_MS = 7 * 24 * 60 * 60_000;

interface Entry {
  /** 확인한 턴 */
  turn: number;
  /** 확인한 시각 */
  at: number;
}

export class AckMemory {
  private readonly file: string;
  private readonly acks: Map<string, Entry>;

  constructor(file: string, now = Date.now()) {
    this.file = file;
    this.acks = load(file, now);
  }

  /** 그 세션에서 확인한 턴. 기록이 없으면 undefined. */
  get(id: string): number | undefined {
    return this.acks.get(id)?.turn;
  }

  remember(id: string, turn: number, now: number): void {
    this.acks.set(id, { turn, at: now });
    this.save();
  }

  forget(id: string): void {
    if (this.acks.delete(id)) this.save();
  }

  private save(): void {
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      writeFileSync(this.file, JSON.stringify(Object.fromEntries(this.acks)));
    } catch {
      // 기록 실패는 재시작 뒤 확인 표시가 다시 보일 뿐이다
    }
  }
}

function load(file: string, now: number): Map<string, Entry> {
  const acks = new Map<string, Entry>();
  try {
    const data = JSON.parse(readFileSync(file, 'utf8')) as unknown;
    if (typeof data !== 'object' || data === null) return acks;
    for (const [id, value] of Object.entries(data)) {
      const { turn, at } = (value ?? {}) as Partial<Entry>;
      if (typeof turn === 'number' && typeof at === 'number' && now - at < ACK_KEEP_MS) acks.set(id, { turn, at });
    }
  } catch {
    // 없거나 깨졌으면 빈 기록으로 시작한다
  }
  return acks;
}
