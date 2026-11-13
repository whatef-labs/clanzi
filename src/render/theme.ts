// 색 기준. 패널·테두리는 핸드오프 6.5의 기존 아이콘 규칙을 따른다.
export const COLOR = {
  panel: '#17181C',
  border: '#30323A',
  track: '#2A2C33',
  text: '#F3F4F6',
  muted: '#9CA3AF',
  faint: '#3A3D47',
  dark: '#111111',

  workingLow: '#0F1A33',
  workingHigh: '#2563EB',
  waiting: '#F97316',
  waitingDim: '#3A1D0A',
  done: '#16A34A',

  ok: '#22C55E',
  warn: '#EAB308',
  danger: '#EF4444',
} as const;

/** 사용률 게이지 색: 70% 미만 초록, 70~89% 노랑, 90% 이상 빨강. */
export function gaugeColor(percent: number): string {
  if (percent >= 90) return COLOR.danger;
  if (percent >= 70) return COLOR.warn;
  return COLOR.ok;
}

/** 두 #RRGGBB 색을 t(0~1) 비율로 섞는다. */
export function mixColor(from: string, to: string, t: number): string {
  const k = Math.min(1, Math.max(0, t));
  const a = parseHex(from);
  const b = parseHex(to);
  return '#' + a.map((v, i) => Math.round(v + ((b[i] ?? v) - v) * k).toString(16).padStart(2, '0')).join('').toUpperCase();
}

function parseHex(hex: string): number[] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
}
