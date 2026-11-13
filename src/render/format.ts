/** 남은 시간을 키에 들어갈 짧은 문자열로 만든다. 예: 2h 10m, 3d 4h, 45m, <1m */
export function formatRemaining(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0m';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 1) return '<1m';
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  return `${mins}m`;
}

/** 사용률을 0~100 정수로 맞춘다. 숫자가 아니면 null. */
export function normalizePercent(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.round(Math.min(100, Math.max(0, value)));
}
