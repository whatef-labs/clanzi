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
 */
export function assignSlots(prev: ReadonlyMap<string, number>, sessionIds: readonly string[], slots: readonly number[]): Map<string, number> {
  const slotSet = new Set(slots);
  const next = new Map<string, number>();
  const used = new Set<number>();
  for (const id of sessionIds) {
    const slot = prev.get(id);
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
