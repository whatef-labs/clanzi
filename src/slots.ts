// 세션을 키(슬롯)에 배정하고 라벨을 정한다.

/** 키 이름 '열_행'을 왼쪽 위부터 1로 시작하는 번호로 바꾼다. D200X는 한 줄에 5키. */
export function slotFromKey(key: string): number {
  const [col, row] = key.split('_').map(Number);
  if (col === undefined || row === undefined || Number.isNaN(col) || Number.isNaN(row)) return 0;
  return row * 5 + col + 1;
}

/**
 * 세션을 슬롯에 배정한다. 이미 배정된 세션은 자리를 지키고, 새 세션은 번호가 가장 작은 빈 슬롯에 들어간다.
 * 슬롯이 모자라면 나머지 세션은 배정하지 않는다.
 * @param sessionIds 화면에 보일 세션, 처음 본 순서대로
 * @param held 아직 돌아오지 않은 세션의 자리(재시작 직후). 그 세션이 보이면 그 자리로 가고, 다른 세션은 그 자리를 쓰지 않는다.
 */
export function assignSlots(
  prev: ReadonlyMap<string, number>,
  sessionIds: readonly string[],
  slots: readonly number[],
  held: ReadonlyMap<string, number> = new Map(),
): Map<string, number> {
  const slotSet = new Set(slots);
  const next = new Map<string, number>();
  const used = new Set<number>();
  const present = new Set(sessionIds);
  for (const [id, slot] of held) if (!present.has(id) && slotSet.has(slot)) used.add(slot);
  for (const id of sessionIds) {
    const slot = prev.get(id) ?? held.get(id);
    if (slot !== undefined && slotSet.has(slot) && !used.has(slot)) {
      next.set(id, slot);
      used.add(slot);
    }
  }
  const free = [...slotSet].filter((s) => !used.has(s)).sort((a, b) => a - b);
  for (const id of sessionIds) {
    if (next.has(id)) continue;
    const slot = free.shift();
    if (slot === undefined) break;
    next.set(id, slot);
  }
  return next;
}

export interface PageLayout {
  /** 슬롯 번호 → 그 슬롯에 보일 세션 ID */
  shown: Map<number, string>;
  pageCount: number;
  /** 범위 안으로 맞춘 현재 페이지(0부터) */
  page: number;
}

/**
 * 페이지별로 슬롯에 보일 세션을 정한다.
 * 0페이지는 고정 배정을 그대로 쓰고, 그 뒤 페이지는 배정받지 못한(넘친) 세션을 슬롯 번호 순서대로 채운다.
 * @param sessionIds 화면에 보일 세션, 처음 본 순서대로
 */
export function pageLayout(assignment: ReadonlyMap<string, number>, sessionIds: readonly string[], slots: readonly number[], page: number): PageLayout {
  const sorted = [...new Set(slots)].sort((a, b) => a - b);
  const overflow = sessionIds.filter((id) => !assignment.has(id));
  const pageCount = sorted.length === 0 ? 1 : 1 + Math.ceil(overflow.length / sorted.length);
  const current = Math.min(Math.max(0, page), pageCount - 1);
  const shown = new Map<number, string>();
  if (current === 0) {
    for (const [id, slot] of assignment) if (sorted.includes(slot)) shown.set(slot, id);
  } else {
    const chunk = overflow.slice((current - 1) * sorted.length, current * sorted.length);
    chunk.forEach((id, i) => shown.set(sorted[i] as number, id));
  }
  return { shown, pageCount, page: current };
}

/** 경로의 마지막 폴더 이름. Windows·POSIX 구분자를 모두 받는다. */
export function folderName(cwd: string): string {
  const parts = cwd.split(/[\\/]+/).filter(Boolean);
  return parts[parts.length - 1] ?? cwd;
}

/** 세션별 라벨. 같은 폴더의 세션이 여럿이면 두 번째부터 번호를 붙인다(처음 본 순서). */
export function sessionLabels(sessions: readonly { id: string; cwd: string }[]): Map<string, string> {
  const seen = new Map<string, number>();
  const labels = new Map<string, string>();
  for (const s of sessions) {
    const name = folderName(s.cwd);
    const key = name.toLowerCase();
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    labels.set(s.id, n === 1 ? name : `${name} ${n}`);
  }
  return labels;
}
