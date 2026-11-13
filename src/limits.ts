// 사용량(한도) 저장소. 계정 전체 값이라 여러 세션이 보내도 가장 최근에 측정된 것 하나만 쓴다.
import type { RateLimit } from './protocol.ts';
import { normalizePercent } from './render/format.ts';

export interface UsageView {
  fiveHour: number | null;
  sevenDay: number | null;
  /** 5시간 한도가 리셋되기까지 남은 초. */
  fiveHourResetsIn: number | null;
}

interface Window {
  percent: number;
  /** mod가 보낸 값 그대로(소수 한 자리). 진단용 */
  raw: number;
  resetsAt: number | null;
}

export class UsageStore {
  private at = 0;
  private windows = new Map<string, Window>();

  /** 더 최근에(또는 같은 시각에) 측정된 값일 때만 바꾼다. 바뀌었으면 true. */
  update(at: number, limits: readonly RateLimit[]): boolean {
    if (limits.length === 0 || at < this.at) return false;
    this.at = at;
    const next = new Map<string, Window>();
    for (const l of limits) {
      const percent = normalizePercent(l.percentUsed);
      if (percent === null) continue;
      const reset = l.resetsAt ? Date.parse(l.resetsAt) : NaN;
      next.set(l.kind, { percent, raw: l.percentUsed, resetsAt: Number.isNaN(reset) ? null : reset });
    }
    this.windows = next;
    return true;
  }

  /** 진단용: 마지막 측정 시각과 창별 값 */
  snapshot(): { measuredAt: number; windows: Record<string, { percent: number; raw: number; resetsAt: string | null }> } {
    const windows: Record<string, { percent: number; raw: number; resetsAt: string | null }> = {};
    for (const [kind, w] of this.windows) {
      windows[kind] = { percent: w.percent, raw: w.raw, resetsAt: w.resetsAt === null ? null : new Date(w.resetsAt).toISOString() };
    }
    return { measuredAt: this.at, windows };
  }

  /** 리셋 시각이 지난 창은 값이 없는 것으로 본다. */
  view(now: number): UsageView {
    const five = this.live('five_hour', now);
    const seven = this.live('seven_day', now);
    return {
      fiveHour: five?.percent ?? null,
      sevenDay: seven?.percent ?? null,
      fiveHourResetsIn: five?.resetsAt ? Math.max(0, (five.resetsAt - now) / 1000) : null,
    };
  }

  private live(kind: string, now: number): Window | undefined {
    const w = this.windows.get(kind);
    if (!w || (w.resetsAt !== null && w.resetsAt <= now)) return undefined;
    return w;
  }
}
