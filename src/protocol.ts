// clanzi mod(claude-plugin/clanzi)가 브리지로 보내는 메시지. 필요한 필드만 골라 검증한다.
import type { SessionStatus } from './render/session.ts';

export type LiveStatus = Exclude<SessionStatus, 'empty'>;

export type ModEvent = 'start' | 'end' | 'beat' | 'turn-start' | 'turn-end' | 'wait' | 'resume' | 'usage';

export interface RateLimit {
  kind: string;
  percentUsed: number;
  /** ISO 8601 */
  resetsAt?: string;
}

export interface ModMessage {
  ev: ModEvent;
  sessionId: string;
  cwd: string;
  status: LiveStatus;
  turn: number;
  /** 보낸 시각(epoch ms). 사용량은 가장 최근 것을 쓴다. */
  at: number;
  rateLimits: RateLimit[];
}

const EVENTS = new Set<string>(['start', 'end', 'beat', 'turn-start', 'turn-end', 'wait', 'resume', 'usage']);
const STATUSES = new Set<string>(['idle', 'working', 'waiting', 'done', 'error']);
const MAX_TEXT = 1024;

/** 형식이 맞지 않으면 null. 알 수 없는 필드는 버린다. */
export function parseModMessage(input: unknown): ModMessage | null {
  if (!isRecord(input) || input.v !== 1) return null;
  const { ev, sessionId, cwd, status, turn, at } = input;
  if (typeof ev !== 'string' || !EVENTS.has(ev)) return null;
  if (!isText(sessionId) || !isText(cwd)) return null;
  if (typeof status !== 'string' || !STATUSES.has(status)) return null;
  return {
    ev: ev as ModEvent,
    sessionId,
    cwd,
    status: status as LiveStatus,
    turn: typeof turn === 'number' && Number.isFinite(turn) ? turn : 0,
    at: typeof at === 'number' && Number.isFinite(at) ? at : 0,
    rateLimits: parseRateLimits(input.rateLimits),
  };
}

function parseRateLimits(input: unknown): RateLimit[] {
  if (!Array.isArray(input)) return [];
  const out: RateLimit[] = [];
  for (const item of input.slice(0, 8)) {
    if (!isRecord(item) || !isText(item.kind) || typeof item.percentUsed !== 'number' || !Number.isFinite(item.percentUsed)) continue;
    const limit: RateLimit = { kind: item.kind, percentUsed: item.percentUsed };
    if (isText(item.resetsAt)) limit.resetsAt = item.resetsAt;
    out.push(limit);
  }
  return out;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isText(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0 && v.length <= MAX_TEXT;
}
