// 세션 저장소: mod 메시지로 세션 상태를 유지하고, 화면에 보일 세션과 키에 그릴 상태를 정한다.
// 상태의 주인은 mod다. 플러그인은 받은 상태를 그대로 쓰고, 사용자가 키를 눌러 확인한 표시만 따로 기억한다.
import type { LiveStatus, ModMessage } from './protocol.ts';

/** mod는 20초마다 신호를 보낸다. 세 번 넘게 끊기면 강제 종료 등으로 끝난 것으로 본다. */
export const EXPIRE_MS = 70_000;
/** VS Code가 내부적으로 띄웠다 곧바로 닫는 세션을 걸러 내는 유예 시간. */
export const SETTLE_MS = 1_500;

export interface Session {
  id: string;
  cwd: string;
  status: LiveStatus;
  turn: number;
  /** 처음 본 시각. 슬롯 배정 순서가 된다. */
  firstSeen: number;
  lastSeen: number;
  /** 이 시각부터 화면에 보인다. */
  visibleFrom: number;
  /** 사용자가 키를 눌러 완료·오류 표시를 해제한 턴. */
  ackTurn?: number;
  origin?: string;
  pid?: number;
}

export class SessionStore {
  private readonly sessions = new Map<string, Session>();

  /** 메시지를 반영한다. */
  apply(msg: ModMessage, now: number): void {
    if (msg.ev === 'end') {
      this.sessions.delete(msg.sessionId);
      return;
    }
    const prev = this.sessions.get(msg.sessionId);
    if (!prev) {
      // 막 시작한 빈 세션만 유예한다. 이미 작업 중인 세션(플러그인 재시작 후 복구)은 바로 보인다.
      const settle = msg.ev === 'start' && msg.status === 'idle' ? SETTLE_MS : 0;
      this.sessions.set(msg.sessionId, {
        id: msg.sessionId,
        cwd: msg.cwd,
        status: msg.status,
        turn: msg.turn,
        firstSeen: now,
        lastSeen: now,
        visibleFrom: now + settle,
        origin: msg.origin,
        pid: msg.pid,
      });
      return;
    }
    if (msg.origin) prev.origin = msg.origin;
    if (msg.pid) prev.pid = msg.pid;
    prev.cwd = msg.cwd;
    prev.status = msg.status;
    prev.turn = msg.turn;
    prev.lastSeen = now;
    if (msg.status !== 'idle') prev.visibleFrom = Math.min(prev.visibleFrom, now);
  }

  /** 완료·오류 표시를 확인 처리해 대기로 보이게 한다. 바뀌었으면 true. */
  acknowledge(id: string): boolean {
    const s = this.sessions.get(id);
    if (!s || (s.status !== 'done' && s.status !== 'error') || s.ackTurn === s.turn) return false;
    s.ackTurn = s.turn;
    return true;
  }

  /** 신호가 끊긴 세션을 지운다. 지운 세션 ID를 돌려준다. */
  expire(now: number): string[] {
    const removed: string[] = [];
    for (const [id, s] of this.sessions) {
      if (now - s.lastSeen > EXPIRE_MS) {
        this.sessions.delete(id);
        removed.push(id);
      }
    }
    return removed;
  }

  /** 화면에 보일 세션, 처음 본 순서대로. */
  visible(now: number): Session[] {
    return [...this.sessions.values()].filter((s) => s.visibleFrom <= now).sort((a, b) => a.firstSeen - b.firstSeen);
  }

  all(): Session[] {
    return [...this.sessions.values()];
  }

  get(id: string): Session | undefined {
    return this.sessions.get(id);
  }

  /** 키에 그릴 상태. 사용자가 확인한 완료·오류는 대기로 보인다. */
  static displayStatus(s: Session): LiveStatus {
    if ((s.status === 'done' || s.status === 'error') && s.ackTurn === s.turn) return 'idle';
    return s.status;
  }
}
