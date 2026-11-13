// 슬롯 배정을 파일에 남겨, 플러그인이 다시 시작돼도(Studio 재시작 등) 세션이 원래 자리로 돌아오게 한다.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** 재시작 뒤 이전 자리를 비워 두고 세션을 기다리는 시간. mod의 주기 신호(20초)보다 조금 길다. */
export const HOLD_MS = 25_000;

export class SlotMemory {
  private readonly file: string;
  private readonly held: Map<string, number>;
  private readonly holdUntil: number;
  private lastSaved = '';

  constructor(file: string, now = Date.now()) {
    this.file = file;
    // 오래된 기록이라도 그 세션들은 돌아오지 않을 뿐이고, 자리는 HOLD_MS 뒤에 풀린다.
    this.held = load(file);
    this.holdUntil = now + HOLD_MS;
  }

  /** 아직 기다리는 이전 배정. 기다리는 시간이 지나면 비어 있다. */
  holds(now: number): ReadonlyMap<string, number> {
    return now < this.holdUntil ? this.held : EMPTY;
  }

  /** 배정이 바뀌었을 때만 파일에 쓴다. */
  save(assignment: ReadonlyMap<string, number>, now: number): void {
    const slots = Object.fromEntries(assignment);
    const text = JSON.stringify(slots);
    if (text === this.lastSaved) return;
    this.lastSaved = text;
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      writeFileSync(this.file, JSON.stringify({ savedAt: now, slots }));
    } catch {
      // 기록 실패는 자리 유지가 안 될 뿐이다
    }
  }
}

const EMPTY: ReadonlyMap<string, number> = new Map();

function load(file: string): Map<string, number> {
  try {
    const data = JSON.parse(readFileSync(file, 'utf8')) as { slots?: unknown };
    if (typeof data.slots !== 'object' || data.slots === null) return new Map();
    return new Map(Object.entries(data.slots).filter((e): e is [string, number] => typeof e[1] === 'number'));
  } catch {
    return new Map();
  }
}
